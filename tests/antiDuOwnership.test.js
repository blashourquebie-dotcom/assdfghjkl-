const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');
const source = fs.readFileSync(path.join(__dirname, '../utils/antiDu.js'), 'utf8');

function setup() {
  const scope = new AsyncLocalStorage(), configs = { league: { validationChannelId: 'private' }, test: {} };
  const sessions = {}, store = { linksByGuild: {} }, sent = [];
  const sandbox = { module: { exports: {} }, console, require(name) {
    if (['crypto', 'discord.js'].includes(name)) return require(name);
    if (name === './database') return {
      withGuild: (guild, run) => scope.run(guild, run),
      readConfig: () => structuredClone(configs[scope.getStore()] || {}),
      saveConfig: cfg => { configs[scope.getStore()] = structuredClone(cfg); }
    };
    if (name === './officials') return {
      readStore: () => store,
      updatePendingSession: (id, patch) => Object.assign(sessions[id], patch),
      listPendingSessions: () => Object.values(sessions)
    };
    if (name === './tournamentScope') return { TEST_GUILD: 'test', allowedGuild: g => ['league', 'test'].includes(g) };
    throw Error('Unexpected dependency (host data must not be read by report): ' + name);
  } };
  vm.runInNewContext(source, sandbox);
  const api = sandbox.module.exports;
  const client = { channels: { fetch: async () => ({ guildId: 'league', isTextBased: () => true,
    permissionsFor: () => ({ has: () => false }), send: async payload => { sent.push(JSON.parse(JSON.stringify(payload))); } }) } };
  const stamp = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  function entrance(id, user, minutes, patch = {}) {
    return sessions[id] = { id, guildId: 'league', matchedUserId: user, matchedBy: 'auth', playerName: user,
      playerId: 'profile-' + user, room: 'Room', auth: 'auth-' + user, conn: 'same-conn', ip: '192.0.2.1',
      status: 'confirmed', confirmedAt: stamp(minutes), reportingV2: true,
      hostContext: { reportedIp: '198.51.100.20', version: '0.1.1', ownerValidationId: 'owner-secret' }, ...patch };
  }
  return { api, configs, sessions, store, sent, client, stamp, entrance };
}

test('A enters, B shares A network, A returns clean; B remains suspicious on every return', async () => {
  const { api, configs, sent, client, entrance } = setup();
  const a = entrance('a1', 'A', 100);
  await api.recordValidation(client, a);
  const b = entrance('b1', 'B', 90);
  assert.equal(api.inspection(b).result.score, 125);
  await api.recordValidation(client, b);
  const a2 = entrance('a2', 'A', 80);
  assert.equal(api.inspection(a2).result.score, 0);
  assert(api.autoValidation({ ...a2, status: 'pending', confirmedAt: null }));
  await api.recordValidation(client, a2);
  const b2 = entrance('b2', 'B', 70);
  assert.equal(api.inspection(b2).result.score, 125);
  assert.equal(api.autoValidation({ ...b2, status: 'pending', confirmedAt: null }), null);
  // Simulate trimmed rolling history + process restart: origin index is JSON state.
  configs.league.antiDuHistory = configs.league.antiDuHistory.filter(row => row.userId === 'B');
  configs.league.antiDuOrigins = JSON.parse(JSON.stringify(configs.league.antiDuOrigins));
  assert.equal(api.inspection(entrance('a3', 'A', 60)).result.score, 0);
  assert.equal(api.inspection(b2).result.score, 125);
  const reports = JSON.stringify(sent);
  for (const value of ['198.51.100.20', '192.0.2.1', 'same-conn', 'auth-A', 'auth-B', 'Contexto del host', 'Coincidencias del hoster', 'owner-secret']) assert(!reports.includes(value), value);
  assert(sent[2].embeds[0].description.includes('**0%**'));
});

test('prior Discord registration protects A even if B is the first to enter this league', async () => {
  const { api, store, client, entrance, stamp } = setup();
  store.linksByGuild.test = { A: { links: [{ createdAt: stamp(150), auth: 'auth-A', ip: '192.0.2.1', conn: 'same-conn' }] } };
  const b = entrance('b1', 'B', 90);
  assert.equal(api.inspection(b).result.score, 125);
  await api.recordValidation(client, b);
  assert.equal(api.inspection(entrance('a1', 'A', 80)).result.score, 0);
  assert.equal(api.inspection(entrance('b2', 'B', 70)).result.score, 125);
});

test('own data changes are not DU, but do not bypass the strict autovalidation fingerprint', async () => {
  const { api, client, entrance } = setup();
  await api.recordValidation(client, entrance('a1', 'A', 100));
  const changed = entrance('a2', 'A', 90, { auth: 'new-own-auth', conn: 'new-own-conn', ip: '192.0.2.2' });
  assert.equal(api.inspection(changed).result.score, 0);
  assert.equal(api.autoValidation({ ...changed, status: 'pending', confirmedAt: null }), null);
});

test('chronology is directional, older report retries ignore later users and timestamp ties stay ambiguous', () => {
  const { api, stamp } = setup();
  const a = { userId: 'A', ip: 'ip', conn: 'conn', auth: 'auth', at: stamp(100) };
  const b = { ...a, userId: 'B', at: stamp(90) };
  assert.equal(api.evaluate([b, a], { ...a, at: stamp(80) }).score, 0);
  assert.equal(api.evaluate([a, b], { ...b, at: stamp(80) }).score, 150);
  assert.equal(api.evaluate([b], a).score, 0);
  const tied = { ...b, at: a.at };
  assert(api.evaluate([a, tied], { ...a, at: stamp(80) }).score > 0);
});

test('origins are league-scoped and foreign/unregistered host data cannot become player evidence', () => {
  const { api, store, entrance, stamp } = setup();
  store.linksByGuild.unknown = { B: { links: [{ createdAt: stamp(150), ip: '192.0.2.1', conn: 'same-conn', auth: 'auth-A' }] } };
  const a = entrance('a1', 'A', 100);
  assert.equal(api.inspection(a).result.score, 0);
  assert.equal(api.inspection({ ...a, hostContext: { reportedIp: 'any-other-ip' } }).result.score, 0);
});
