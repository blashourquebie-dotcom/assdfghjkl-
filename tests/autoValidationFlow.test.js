const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(eligible) {
  const session = { id: 'entry', validationId: 'validation', guildId: 'league', status: 'pending', matchedUserId: 'user', playerName: 'player' };
  const calls = { users: 0, guilds: 0, dms: 0, reports: 0 };
  const sandbox = { module: { exports: {} }, console, require(name) {
    if (name === 'discord.js') return require(name);
    if (name === '../utils/alerts') return { sendAlert: async () => {} };
    if (name === '../commands/validarauth') return { buildValidationComponents: () => [] };
    if (name === '../utils/tournamentScope') return { allowedGuild: () => true };
    if (name === '../utils/officials') return {
      readStore: () => ({ linksByGuild: {} }),
      findLinkedDiscord: () => ({ userId: 'user', reason: 'auth' }),
      upsertPendingSession: () => structuredClone(session),
      updatePendingSession: (_, update) => { Object.assign(session, update); return structuredClone(session); },
      addPlayerAlias: () => {}
    };
    if (name === '../utils/antiDu') return {
      autoValidation: () => eligible ? { manualConfirmedAt: '2026-09-17T10:00:00Z' } : null,
      recordValidation: (_, value) => {
        assert.equal(value.status, 'confirmed');
        assert.equal(session.status, 'confirmed', 'saved before scheduling reports');
        calls.reports++;
        return new Promise(() => {}); // slow Discord/Supabase must not hold admission
      }
    };
    throw Error(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../handlers/webhookHandler.js'), 'utf8'), sandbox);
  const client = {
    users: { fetch: async () => { calls.users++; return { send: async () => { calls.dms++; } }; } },
    guilds: { fetch: async () => { calls.guilds++; return null; } }
  };
  return { session, calls, invoke: () => sandbox.module.exports.processOfficialPayload(client,
    { playerName: 'player', validationId: 'validation', autoValidation: true }, { guildId: 'league' }) };
}

test('automatic admission returns while reports are pending, without fetching a DM recipient or sending MD', async () => {
  const flow = setup(true);
  let timer;
  try {
    const result = await Promise.race([flow.invoke(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Admission blocked by report delivery')), 500);
    })]);
    assert.equal(result.session.status, 'confirmed');
    assert.equal(result.automatic, true);
    assert.equal(flow.session.manualConfirmedAt, '2026-09-17T10:00:00Z');
    assert.deepEqual(flow.calls, { users: 0, guilds: 0, dms: 0, reports: 1 });
    await flow.invoke(); // already-confirmed retries remain silent and non-blocking
    assert.equal(flow.calls.dms, 0);
  } finally { clearTimeout(timer); }
});

test('ineligible automatic entry still requires the regular Discord confirmation', async () => {
  const flow = setup(false);
  const result = await flow.invoke();
  assert.equal(result.session.status, 'pending');
  assert.equal(flow.calls.dms, 1);
  assert.equal(flow.calls.reports, 0);
});
