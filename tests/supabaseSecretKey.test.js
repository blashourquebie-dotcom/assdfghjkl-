const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('Supabase secret key usa apikey sin Authorization Bearer', () => {
  const script = `
    process.env.SUPABASE_URL = 'https://example.invalid';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy_key';
    global.fetch = async (_url, options) => {
      process.stdout.write(JSON.stringify(options.headers));
      return { ok: true, status: 200, text: async () => '[]' };
    };
    require('./utils/haxoleSupabase').request('torneos').catch(error => {
      process.stderr.write(String(error)); process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const headers = JSON.parse(result.stdout);
  assert.equal(headers.apikey, 'sb_secret_test');
  assert.equal(headers.Authorization, undefined);
});
