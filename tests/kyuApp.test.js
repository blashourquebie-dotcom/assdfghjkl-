const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configuration, createIntegration } = require('../utils/kyuApp');

function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kyu-bot-test-'));
  const env = { KYU_ENABLED: '1', CLIENT_ID: 'test-client', TOKEN: 'test-bot', KYU_CLIENT_SECRET: 'test-secret', KYU_GUILD_ID: '123456789012345678', KYU_PLAYER_ROLE_ID: 'player', KYU_PUBLIC_URL: 'https://example.invalid', KYU_DATA_FILE: path.join(directory, 'state.json'), ...overrides };
  const state = { roles: ['player'], calls: [] };
  const transport = async (url, options = {}) => {
    state.calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) {
      assert.equal(options.body.get('redirect_uri'), 'https://example.invalid/auth/callback');
      assert.equal(options.body.get('client_id'), 'test-client');
      return Response.json({ access_token: 'oauth-test' });
    }
    if (url.endsWith('/users/@me')) return Response.json({ id: '234567890123456789' });
    if (url.endsWith('/members/234567890123456789')) return Response.json({ user: { username: 'test' }, roles: state.roles });
    if (url.endsWith('/roles')) return Response.json([{ id: 'player', name: 'kyu' }, { id: 'pro', name: 'pro' }, { id: 'proplus', name: 'pro+' }, {id:'1556085795998146641',name:'beta'}, {id:'1556085812834344962',name:'ver'}]);
    throw new Error('Unexpected mock request: ' + url);
  };
  const integration = createIntegration(env, transport);
  t.after(() => integration.close());
  return { integration, state, env };
}

async function listener(t, integration) {
  const server = http.createServer((req, res) => {
    if (!integration.route(req, res)) { res.writeHead(418); res.end('existing bot'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  return (route, options) => fetch(base + route, options);
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('Kyu owner server and commands work before OAuth setup without granting app access or league rights', () => {
  const id = '1510011417712132117';
  for (const env of [{}, { KYU_ENABLED: '0' }]) {
    const kyu = createIntegration(env);
    assert.equal(kyu.config.env.DISCORD_GUILD_ID, id);
    assert.equal(kyu.canStayInGuild(id), true);
    assert.equal(kyu.isGuild(id), true);
    assert.equal(kyu.config.enabled, false, 'app login remains disabled');
    assert.equal(kyu.commandsFor(id).length, 14);
    assert.equal(kyu.canStayInGuild('999999999999999999'), false);
  }
  const active = createIntegration({ KYU_ENABLED: '1' });
  assert.equal(active.isGuild(id), true);
  assert.equal(active.commandsFor(id).length, 14);
  assert.equal(require('../utils/tournamentScope').allowedGuild(id), false);
  assert.equal(require('../utils/tournamentScope').leagueForGuild(id), null);
  const overridden = createIntegration({ KYU_ENABLED: '1', KYU_GUILD_ID: '123456789012345678' });
  assert.equal(overridden.canStayInGuild('123456789012345678'), true);
  assert.equal(overridden.canStayInGuild(id), true);
  assert.equal(overridden.isGuild(id), false, 'explicit configuration still controls OAuth/commands');
});

test('existing credentials map without changing league scope; public URL must be an HTTPS origin', () => {
  const cfg = configuration({ CLIENT_ID: 'current', DISCORD_CLIENT_ID: 'other', TOKEN: 'current-token', KYU_CLIENT_SECRET: 'secret', KYU_PUBLIC_URL: 'https://example.invalid/' });
  assert.equal(cfg.env.DISCORD_CLIENT_ID, 'current');
  assert.equal(cfg.env.DISCORD_BOT_TOKEN, 'current-token');
  assert.equal(cfg.env.PUBLIC_URL, 'https://example.invalid');
  for (const value of ['http://example.invalid', 'https://example.invalid/auth/callback', 'https://user:password@example.invalid']) assert.equal(configuration({ KYU_PUBLIC_URL: value }).env.PUBLIC_URL, '');
  const kyu = createIntegration({ KYU_ENABLED: '1', KYU_GUILD_ID: '123456789012345678' });
  assert.equal(kyu.isGuild('123456789012345678'), true);
  assert.equal(kyu.commandsFor('another').length, 0);
  assert.equal(kyu.commandsFor('123456789012345678').length, 14);
  assert.equal(require('../utils/tournamentScope').allowedGuild('123456789012345678'), false);
});

test('disabled login fails closed and unrelated bot routes remain untouched', async t => {
  const { integration } = setup(t, { KYU_ENABLED: '0' });
  const request = await listener(t, integration);
  assert.equal((await request('/v1/pair', post({}))).status, 503);
  assert.equal((await request('/api/status')).status, 418);
  assert.equal((await request('/interactions')).status, 418, 'gateway bot must not claim a webhook endpoint');
});

test('OAuth pairing through existing HTTP listener validates cookie, role, single-use exchange and revocation', async t => {
  const { integration, state } = setup(t);
  const request = await listener(t, integration);
  assert.deepEqual(await (await request('/kyu/health')).json(), { ok: true, configured: true });
  const pair = await (await request('/v1/pair', post({}))).json();
  const start = await request('/auth/start?pair=' + pair.id, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const oauth = new URL(start.headers.get('location'));
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.equal(oauth.searchParams.get('scope'), 'identify');
  const callback = '/auth/callback?code=test&state=' + oauth.searchParams.get('state');
  assert.equal((await request(callback, { headers: { cookie } })).status, 200);
  assert.equal((await request('/v1/pair/status', post({ id: pair.id, secret: 'wrong' }))).status, 403);
  const session = await (await request('/v1/pair/status', post(pair))).json();
  assert.equal(session.ready, true);
  assert.equal(session.user.allowed, true);
  assert.equal(session.user.pro, true);
  assert.equal((await request('/v1/pair/status', post(pair))).status, 403);
  const auth = { headers: { Authorization: 'Bearer ' + session.token } };
  assert.equal((await request('/v1/me', auth)).status, 200);
  state.roles = [];
  assert.equal((await request('/v1/me', auth)).status, 403);
  state.roles = ['player'];
  assert.equal((await request('/v1/me', auth)).status, 403, 'revoked sessions do not resurrect');
  assert.equal((await request('/v1/me')).status, 403);
  const second = await (await request('/v1/pair', post({}))).json();
  const start2 = await request('/auth/start?pair=' + second.id, { redirect: 'manual' });
  const callback2 = '/auth/callback?code=test&state=' + new URL(start2.headers.get('location')).searchParams.get('state');
  assert.equal((await request(callback2)).status, 403, 'missing browser cookie cannot authorize');
});

test('no Kyu role means no login token', async t => {
  const { integration, state } = setup(t);
  state.roles = [];
  const request = await listener(t, integration);
  const pair = await (await request('/v1/pair', post({}))).json();
  const start = await request('/auth/start?pair=' + pair.id, { redirect: 'manual' });
  const callback = '/auth/callback?code=test&state=' + new URL(start.headers.get('location')).searchParams.get('state');
  assert.equal((await request(callback, { headers: { cookie: start.headers.get('set-cookie').split(';')[0] } })).status, 403);
  const status = await (await request('/v1/pair/status', post(pair))).json();
  assert.equal(status.ready, false);
  assert.equal(status.token, undefined);
});

test('gateway commands enforce real Discord permissions and isolate the configured guild', async t => {
  const { integration, state, env } = setup(t, { KYU_ENABLED: undefined, KYU_GUILD_ID: undefined, KYU_CLIENT_SECRET: '', KYU_PUBLIC_URL: '', KYU_PRO_ROLE_ID: 'pro', KYU_PRO_PLUS_ROLE_ID: 'proplus' });
  const guildId = '1510011417712132117';
  function interaction(guildId, permissions) {
    const results = [];
    return { guildId, commandName: 'instalaciónkyu', channelId: 'channel', user: { id: '234567890123456789' }, memberPermissions: { bitfield: permissions }, member: { roles: { cache: new Map() } }, isChatInputCommand: () => true, options: { data: [] }, results,
      reply: async x => results.push(x), deferReply: async x => results.push(x), editReply: async x => results.push(x) };
  }
  const foreign = interaction('other', 8n);
  await integration.interaction(foreign);
  assert.match(foreign.results[0].content, /no está habilitado/);
  const denied = interaction(guildId, 0n);
  await integration.interaction(denied);
  assert.match(denied.results[1].content, /Administrar servidor/);
  assert.equal(state.calls.length, 0);
  const allowed = interaction(guildId, 32n);
  await integration.interaction(allowed);
  assert.match(allowed.results[1].content, /Roles Kyu, Pro y Pro\+ configurados/);
  assert.equal(allowed.results[0].flags, 64);
  assert.deepEqual(allowed.results[1].allowedMentions, { parse: [] });
  assert.equal(JSON.parse(fs.readFileSync(env.KYU_DATA_FILE)).roles.playerRole, 'player');
});

test('owner role IDs are scoped to Kyu, with explicit environment overrides', () => {
  const cfg=configuration({}).env;
  assert.equal(cfg.KYU_PLAYER_ROLE_ID,'1553753550251622550');
  assert.equal(cfg.KYU_PRO_ROLE_ID,'1553753551187091546');
  assert.equal(cfg.KYU_PRO_PLUS_ROLE_ID,'1553753552080343162');
  assert.equal(configuration({KYU_PLAYER_ROLE_ID:' other-role '}).env.KYU_PLAYER_ROLE_ID,'other-role');
  assert.equal(configuration({KYU_GUILD_ID:'another'}).env.KYU_PLAYER_ROLE_ID,'');
});

test('real Kyu role IDs authenticate despite stale saved roles; stale IDs no longer grant access', async t => {
  const { integration, state, env }=setup(t,{KYU_GUILD_ID:'1510011417712132117',KYU_PLAYER_ROLE_ID:undefined});
  fs.writeFileSync(env.KYU_DATA_FILE,JSON.stringify({roles:{playerRole:'obsolete-player',pro:'obsolete-pro',guild:'wrong-guild'}}));
  state.roles=['1553753550251622550'];
  const request=await listener(t,integration);
  const pair=await(await request('/v1/pair',post({}))).json();
  const start=await request('/auth/start?pair='+pair.id,{redirect:'manual'});
  const callback='/auth/callback?code=test&state='+new URL(start.headers.get('location')).searchParams.get('state');
  assert.equal((await request(callback,{headers:{cookie:start.headers.get('set-cookie').split(';')[0]}})).status,200);
  const session=await(await request('/v1/pair/status',post(pair))).json();
  assert.equal(session.user.allowed,true);
  assert.ok(state.calls.some(c=>c.url.includes('/guilds/1510011417712132117/members/')));
  state.roles=['obsolete-player','1553753551187091546','1553753552080343162'];
  const proplus=await request('/v1/me',{headers:{Authorization:'Bearer '+session.token}});
  assert.equal(proplus.status,200);assert.equal((await proplus.json()).user.tier,'proplus');
  state.roles=['obsolete-player'];
  const revoked=await request('/v1/me',{headers:{Authorization:'Bearer '+session.token}});
  assert.equal(revoked.status,403);
  assert.match((await revoked.json()).error,/1553753550251622550/);
});
