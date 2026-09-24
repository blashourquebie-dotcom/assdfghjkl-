const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../utils/database');
const db = require('../utils/haxoleSupabase');
const disable = require('../commands/deshabilitarclub');
const command = require('../commands/borrarclub');

const guildId = 'club-delete-test';
function interaction() {
  const replies = [];
  return {
    guildId, guild: { id: guildId }, user: { id: 'admin' }, member: { permissions: { has: () => true } },
    values: ['0'], replies,
    deferReply: async () => {}, deferUpdate: async () => {},
    reply: async (payload) => { replies.push(payload); return payload; },
    editReply: async (payload) => { replies.push(payload); return payload; },
    update: async (payload) => { replies.push(payload); return payload; }
  };
}

test('/borrarclub lista clubes y nunca deshabilita si falla Supabase', async () => {
  const request = db.request;
  const executeDisableClub = disable.executeDisableClub;
  let disabled = false;
  try {
    await database.withGuild(guildId, async () => {
      const cfg = database.readConfig();
      cfg.clubs = { Azul: { roles: { x3: 'role-x3' } } };
      database.saveConfig(cfg);
      db.request = async (path) => path === 'clubes'
        ? { ok: true, data: [{ id: 'club-1', nombre: 'Azul', archived_at: null }] }
        : { ok: false, status: 400, error: 'Tiene partidos activos' };
      disable.executeDisableClub = async () => { disabled = true; };
      const i = interaction();
      await command.execute(i);
      const [, , token] = i.replies.at(-1).components[0].components[0].data.custom_id.split(':');
      await command.handleSelect(i, ['choose', token]);
      const intruder = interaction(); intruder.user.id = 'otro';
      await command.handleComponent(intruder, ['confirm', token]);
      assert.match(intruder.replies.at(-1).content, /no autorizada/);
      await command.handleComponent(i, ['confirm', token]);
      assert.match(i.replies.at(-1).content, /Tiene partidos activos/);
      assert.equal(disabled, false);
    });
  } finally { db.request = request; disable.executeDisableClub = executeDisableClub; }
});

test('/borrarclub archiva en Supabase y deshabilita el rol tras confirmar', async () => {
  const request = db.request;
  let roleDeleted = false;
  try {
    await database.withGuild(guildId, async () => {
      const cfg = database.readConfig();
      cfg.clubs = { Azul: { roles: { x3: 'role-x3' } } };
      cfg.forumClubs = {};
      database.saveConfig(cfg);
      database.saveUsers({});
      db.request = async (path) => path === 'clubes'
        ? { ok: true, data: [{ id: 'club-1', nombre: 'Azul', archived_at: null }] }
        : { ok: true, data: true };
      const i = interaction();
      i.user.tag = 'admin';
      i.guild.roles = { fetch: async () => ({ members: new Map(), delete: async () => { roleDeleted = true; } }) };
      i.guild.emojis = { cache: new Map(), fetch: async () => null };
      i.guild.members = { fetch: async () => null };
      await command.execute(i);
      const [, , token] = i.replies.at(-1).components[0].components[0].data.custom_id.split(':');
      await command.handleSelect(i, ['choose', token]);
      await command.handleComponent(i, ['confirm', token]);
      assert.equal(roleDeleted, true);
      assert.equal(database.readConfig().clubs.Azul, undefined);
      assert.match(i.replies.at(-1).content, /dado de baja/);
    });
  } finally { db.request = request; }
});
