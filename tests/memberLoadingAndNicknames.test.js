const test = require('node:test');
const assert = require('node:assert/strict');
const plantillas = require('../utils/plantillas');
const nicknames = require('../utils/nicknames');
const database = require('../utils/database');
const state = require('../utils/supabaseState');

test('la lista REST se pagina una vez y las cargas simultáneas se comparten', async () => {
  const calls = [];
  const firstPage = new Map(Array.from({ length: 1000 }, (_, index) => [String(index + 1), { id: String(index + 1) }]));
  const guild = { members: { list: async (options) => {
    calls.push(options);
    return options.after ? new Map([['1001', { id: '1001' }]]) : firstPage;
  }, fetch: async () => { throw Error('No debe pedir la lista por Gateway'); } } };
  await Promise.all([plantillas.ensureGuildMembersLoaded(guild), plantillas.ensureGuildMembersLoaded(guild)]);
  await plantillas.ensureGuildMembersLoaded(guild);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].limit, 1000);
  assert.equal(calls[1].after, '1000');
});

test('apodos automáticos desactivados impiden cualquier setNickname del bot', async () => {
  const docs = { config: {}, users: { guilds: {} } };
  const originalGet = state.getDoc;
  const originalSet = state.setDoc;
  state.getDoc = (key) => structuredClone(docs[key] || {});
  state.setDoc = (key, value) => { docs[key] = structuredClone(value); };
  try {
    await database.withGuild('nickname-off-test', async () => {
      const config = database.readConfig();
      config.automation.autoNicknames = false;
      database.saveConfig(config);
      let edits = 0;
      await nicknames.updateNickname({ setNickname: async () => { edits++; } });
      assert.equal(edits, 0);
    });
  } finally {
    state.getDoc = originalGet;
    state.setDoc = originalSet;
  }
});
