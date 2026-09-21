const { test } = require('node:test');
const assert = require('node:assert/strict');
const scope = require('../utils/tournamentScope');

test('league context is isolated between concurrent commands and supports prefix guild', async () => {
  const values = await Promise.all([
    scope.run({ guildId: '1293616776747286631' }, async () => { await new Promise(setImmediate); return scope.currentLeague(); }),
    scope.run({ guild: { id: '1400962843674804264' } }, async () => { await new Promise(setImmediate); return scope.currentLeague(); }),
    scope.run({ guildId: '1513342723594129458' }, async () => scope.currentLeague())
  ]);
  assert.deepEqual(values, ['ash', 'exclusivo', 'tematico']);
  assert.equal(scope.currentLeague(), null);
});
test('unknown/test guild does not silently pick a duplicate tournament', () => {
  assert.throws(() => scope.unambiguous([{ modalidad_id: 'x3', nombre: 'LIGA T1', tipo: 'ash' }, { modalidad_id: 'x3', nombre: 'LIGA T1', tipo: 'exclusivo' }]), /distintas ligas/);
  assert.equal(scope.unambiguous([{ modalidad_id: 'x3', nombre: 'LIGA T1' }]).length, 1);
  const previous = process.env.HAXOLE_TEST_LEAGUE;
  try {
    delete process.env.HAXOLE_TEST_LEAGUE;
    scope.run({ guildId: '1477848311019864106' }, () => assert.equal(scope.currentLeague(), null));
    process.env.HAXOLE_TEST_LEAGUE = 'ash';
    scope.run({ guildId: '1477848311019864106' }, () => assert.equal(scope.currentLeague(), 'ash'));
  } finally { if (previous === undefined) delete process.env.HAXOLE_TEST_LEAGUE; else process.env.HAXOLE_TEST_LEAGUE = previous; }
});
test('tournament requests receive the command league, without filtering unrelated tables', async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const db = require('../utils/haxoleSupabase');
  const original = global.fetch;
  const urls = [];
  global.fetch = async url => { urls.push(new URL(url)); return { ok: true, status: 200, text: async () => '[]' }; };
  try {
    await scope.run({ guildId: '1293616776747286631' }, async () => {
      await db.request('torneos'); await db.request('clubes');
      await assert.rejects(db.request('torneos', { params: { tipo: 'eq.tematico' } }), /solo podés consultar/);
    });
    assert.equal(urls[0].searchParams.get('tipo'), 'eq.ash');
    assert.equal(urls[1].searchParams.get('tipo'), null);
    assert.equal(urls.length, 2, 'foreign league blocked before network');
  } finally { global.fetch = original; }
});
