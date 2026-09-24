const test = require('node:test');
const assert = require('node:assert/strict');
const { latestExcessSignings, subcaptainTime } = require('../utils/rosterLimitPlan');
const { withRoleLimitLock } = require('../utils/roleLimitLock');
const state = require('../utils/supabaseState');
const db = require('../utils/database');
const verificar = require('../commands/verificar');

test('19 fichados con limite 17: selecciona los dos ultimos fichajes', () => {
  const members = Array.from({ length: 19 }, (_, index) => ({ id: String(index + 1) }));
  const users = Object.fromEntries(members.map((member, index) => [member.id, {
    clubAffiliations: { GUTD: { modalities: { x3: { signedAt: new Date(Date.UTC(2026, 8, 21 + Math.floor(index / 16), index % 16)).toISOString() } } } }
  }]));
  const plan = latestExcessSignings(members, users, 'GUTD', 'x3', 17);
  assert.equal(plan.excess, 2);
  assert.deepEqual(plan.selected.map((member) => member.id), ['19', '18']);
});

test('fecha faltante: no cancela jugadores arbitrariamente', () => {
  const members = [{ id: '1' }, { id: '2' }];
  const users = { 1: { history: [{ action: 'FICHO', details: { club: 'GUTD', modality: 'x3' }, timestamp: '2026-09-21T19:09:00Z' }] } };
  assert.deepEqual(latestExcessSignings(members, users, 'GUTD', 'x3', 1).undated, ['2']);
  assert.deepEqual(latestExcessSignings(members, users, 'GUTD', 'x3', 1).selected, []);
});

test('empate de fecha en el corte: evita decidir por ID de Discord', () => {
  const members = [{ id: '1' }, { id: '2' }];
  const users = Object.fromEntries(members.map(({ id }) => [id, { clubAffiliations: { GUTD: { modalities: { x3: { signedAt: '2026-09-23T12:00:00Z' } } } } }]));
  const plan = latestExcessSignings(members, users, 'GUTD', 'x3', 1);
  assert.equal(plan.ambiguous, true);
  assert.deepEqual(plan.selected, []);
});

test('historial SC permite identificar la asignacion mas reciente', () => {
  const user = { history: [
    { action: 'SC', details: { club: 'OTRO' }, timestamp: '2026-09-23T12:00:00Z' },
    { action: 'SC', details: { club: 'GUTD' }, timestamp: '2026-09-22T12:00:00Z' }
  ] };
  assert.equal(subcaptainTime(user, 'GUTD', 'x3'), Date.parse('2026-09-22T12:00:00Z'));
});

test('dos fichajes simultaneos del mismo club no pasan el chequeo a la vez', async () => {
  const order = [];
  const first = withRoleLimitLock('guild', 'club-role', async () => {
    order.push('first start');
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push('first end');
  });
  const second = withRoleLimitLock('guild', 'club-role', async () => { order.push('second start'); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first start', 'first end', 'second start']);
});

test('/verificar limites cancela los dos fichajes recientes y conserva los otros 17', async () => {
  const docs = { config: {}, users: { guilds: {} } };
  const originalGet = state.getDoc, originalSet = state.setDoc;
  state.getDoc = (key) => structuredClone(docs[key] || {});
  state.setDoc = (key, value) => { docs[key] = structuredClone(value); };
  const members = new Map();
  for (let i = 1; i <= 19; i++) {
    const id = String(i);
    const cache = new Map([['club-role', true]]);
    members.set(id, { id, displayName: id, displayAvatarURL: () => '', user: { tag: `jugador${id}` }, roles: {
      cache, remove: async (roleId) => { cache.delete(roleId); }
    } });
  }
  const guild = { id: 'roster-limit-test', memberCount: 19,
    members: { cache: members, fetch: async (arg) => {
      if (typeof arg === 'string') return members.get(arg);
      return arg?.user ? members.get(arg.user) : members;
    } },
    roles: { cache: new Map([['club-role', { id: 'club-role' }]]), fetch: async () => ({ id: 'club-role' }) }
  };
  try {
    await db.withGuild(guild.id, async () => {
      const cfg = db.readConfig();
      cfg.clubs = { GUTD: { name: 'GUTD', roles: { x3: 'club-role' }, captains: {}, subcaptains: {} } };
      cfg.roleLimits = { x3: 17, 'club-role': 17 };
      cfg.automation.autoNicknames = false;
      db.saveConfig(cfg);
      db.saveUsers(Object.fromEntries(Array.from(members.keys()).map((id) => [id, {
        id, clubRoles: { x3: 'club-role' }, clubAffiliations: { GUTD: { modalities: { x3: {
          roleId: 'club-role', signedAt: new Date(Date.UTC(2026, 8, 21, Number(id))).toISOString()
        } } } }, history: []
      }])));
      let response;
      const interaction = { guild, user: { id: 'admin', tag: 'admin' }, member: { permissions: { has: () => true } },
        values: ['limits'], deferReply: async () => {}, editReply: async (payload) => { response = payload; return payload; } };
      await verificar.handleSelect(interaction, ['admin']);
      assert.equal(Array.from(members.values()).filter((member) => member.roles.cache.has('club-role')).length, 17);
      assert.equal(members.get('18').roles.cache.has('club-role'), false);
      assert.equal(members.get('19').roles.cache.has('club-role'), false);
      assert.equal(db.readUsers(guild.id)['19'].clubRoles?.x3, undefined);
      assert.match(response.embeds[0].data.description, /Fichajes recientes cancelados: \*\*2\*\*/);
    });
  } finally { state.getDoc = originalGet; state.setDoc = originalSet; }
});

test('/verificar limites retira el SC mas reciente sin cancelar su fichaje', async () => {
  const docs = { config: {}, users: { guilds: {} } };
  const originalGet = state.getDoc, originalSet = state.setDoc;
  state.getDoc = (key) => structuredClone(docs[key] || {});
  state.setDoc = (key, value) => { docs[key] = structuredClone(value); };
  const members = new Map(['old', 'new'].map((id) => [id, { id,
    roles: { cache: new Map([['club-role', true]]), remove: async () => { throw Error('No debe cancelar fichajes'); } },
    user: { tag: id }
  }]));
  const guild = { id: 'sc-limit-test', memberCount: 2,
    members: { fetch: async (arg) => arg?.user ? members.get(arg.user) : members },
    roles: { cache: new Map([['club-role', { id: 'club-role' }]]), fetch: async () => ({ id: 'club-role' }) }
  };
  try {
    await db.withGuild(guild.id, async () => {
      const cfg = db.readConfig();
      cfg.clubs = { GUTD: { name: 'GUTD', roles: { x3: 'club-role' }, captains: {}, subcaptains: { general: 'old', x3: 'new' } } };
      cfg.roleLimits = { 'club-role': 17 };
      cfg.subcaptainLimit = 1;
      db.saveConfig(cfg);
      db.saveUsers(Object.fromEntries(['old', 'new'].map((id, i) => [id, { id,
        clubRoles: { x3: 'club-role' }, history: [{ action: 'SC', details: { club: 'GUTD' }, timestamp: `2026-09-2${i + 1}T12:00:00Z` }]
      }])));
      const interaction = { guild, user: { id: 'admin', tag: 'admin' }, member: { permissions: { has: () => true } },
        values: ['limits'], deferReply: async () => {}, editReply: async (payload) => payload };
      await verificar.handleSelect(interaction, ['admin']);
      assert.equal(db.readConfig().clubs.GUTD.subcaptains.general, 'old');
      assert.equal(db.readConfig().clubs.GUTD.subcaptains.x3, undefined);
      assert.equal(members.get('new').roles.cache.has('club-role'), true);
    });
  } finally { state.getDoc = originalGet; state.setDoc = originalSet; }
});

test('/verificar limites no toca roles si Discord devuelve una lista incompleta', async () => {
  const guild = { id: 'incomplete-roster-test', memberCount: 19, members: { fetch: async () => new Map([['1', { id: '1' }]]) } };
  let response;
  const interaction = { guild, user: { id: 'admin' }, member: { permissions: { has: () => true } },
    values: ['limits'], deferReply: async () => {}, editReply: async (payload) => { response = payload; return payload; } };
  await db.withGuild(guild.id, () => verificar.handleSelect(interaction, ['admin']));
  assert.match(response.content, /No corregi ningun limite/);
});
