const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('dos escrituras simultáneas del alias no generan 23505 ni roban la identidad', () => {
  const script = `
    process.env.SUPABASE_URL = 'https://example.invalid';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
    const player = { id: 'player-1', discord_user_id: 'user-1', created_at: '2026-01-01' };
    let aliasReads = 0;
    let owner = 'player-1';
    let insertHeaders;
    global.fetch = async (url, options) => {
      const table = new URL(url).pathname.split('/').at(-1);
      let data = [];
      if (table === 'jugadores') data = [player];
      if (table === 'jugador_aliases' && options.method === 'GET') {
        aliasReads++;
        if (aliasReads > 1) data = [{ id: 'alias-1', jugador_id: owner }];
      }
      if (table === 'jugador_aliases' && options.method === 'POST') {
        insertHeaders = { prefer: options.headers.Prefer, conflict: new URL(url).searchParams.get('on_conflict') };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    };
    const scope = require('./utils/tournamentScope');
    const db = require('./utils/haxoleSupabase');
    const run = async (winner) => {
      owner = winner; aliasReads = 0;
      return scope.run({ guildId: scope.TEST_GUILD }, () => db.upsertPlayerIdentity({
        guildId: scope.TEST_GUILD, discordUserId: 'user-1', haxballName: 'Pepito'
      }));
    };
    (async () => {
      const same = await run('player-1');
      const foreign = await run('player-2');
      process.stdout.write(JSON.stringify({ same: same.alias?.id, foreign: foreign.alias, insertHeaders }));
    })().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.same, 'alias-1');
  assert.equal(value.foreign, null);
  assert.match(value.insertHeaders.prefer, /ignore-duplicates/);
  assert.equal(value.insertHeaders.conflict, 'discord_guild_id,normalized_alias');
});
