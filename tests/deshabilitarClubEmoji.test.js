const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../utils/database');
const { executeDisableClub } = require('../commands/deshabilitarclub');

test('el emoji se elimina solo al deshabilitar la última modalidad del club', async () => {
  const guildId = 'disable-emoji-test';
  const emojiId = '1550610613376520312';
  let deleted = 0;
  const role = { members: new Map(), delete: async () => {} };
  const emoji = { delete: async () => { deleted++; } };
  const guild = {
    id: guildId,
    roles: { fetch: async () => role },
    emojis: { cache: new Map([[emojiId, emoji]]), fetch: async () => emoji },
    members: { fetch: async () => null }
  };
  const interaction = mod => ({
    guild, user: { tag: 'admin' }, member: { permissions: { has: () => true } },
    options: { getString: key => key === 'club' ? 'Azul' : mod },
    reply: async value => value
  });
  await database.withGuild(guildId, async () => {
    const cfg = database.readConfig();
    cfg.clubs = { Azul: { roles: { x3: 'role-x3', x4: 'role-x4' }, emoji: `<:AZUL:${emojiId}>` } };
    cfg.forumClubs = {};
    database.saveConfig(cfg);
    database.saveUsers({});
    await executeDisableClub(interaction('x3'));
    assert.equal(deleted, 0);
    assert.equal(database.readConfig().clubs.Azul.emoji, `<:AZUL:${emojiId}>`);
    await executeDisableClub(interaction('x4'));
    assert.equal(deleted, 1);
    assert.equal(database.readConfig().clubs.Azul, undefined);
  });
});
