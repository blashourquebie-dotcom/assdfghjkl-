const test = require('node:test');
const assert = require('node:assert/strict');

test('los cambios rápidos de un documento llegan juntos y en orden', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const clientPath = require.resolve('../utils/supabaseClient');
  const statePath = require.resolve('../utils/supabaseState');
  delete require.cache[clientPath];
  delete require.cache[statePath];
  const client = require(clientPath);
  const original = client.upsertRows;
  const writes = [];
  client.upsertRows = async (_table, rows) => {
    writes.push(rows[0].data.value);
    await new Promise(resolve => setTimeout(resolve, 30));
    return { ok: true };
  };
  try {
    const state = require(statePath);
    for (let value = 1; value <= 20; value++) state.setDoc('test-roster', { value });
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.deepEqual(writes, [20]);
    state.setDoc('test-roster', { value: 21 });
    await new Promise(resolve => setTimeout(resolve, 270));
    state.setDoc('test-roster', { value: 22 });
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.deepEqual(writes, [20, 21, 22]);
  } finally {
    client.upsertRows = original;
    delete require.cache[statePath];
    delete require.cache[clientPath];
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
