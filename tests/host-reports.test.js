const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { normalizeIp, findHostNetworkMatches, hostMatchField } = require('../utils/hostNetworkMatches');
const { createHostReporter, parseHostReport, readHostBody } = require('../utils/hostReports');
const scope = require('../utils/tournamentScope');
const guild = '1293616776747286631', other = '1400962843674804264', user = '123456789012345678', user2 = '123456789012345679';
const ip = '192.0.2.42', conn = Buffer.from(ip).toString('hex');
const store = { linksByGuild: { [guild]: { [user]: { links: [{ ip, conn }] }, [user2]: { links: [{ conn }] } },
  unknown: { '123456789012345680': { links: [{ ip, conn }] } } }, pendingSessions: {
    confirmed: { guildId: other, matchedUserId: user, ip, conn, status: 'confirmed', confirmedAt: new Date().toISOString() },
    pending: { guildId: guild, matchedUserId: '123456789012345681', ip, conn, status: 'pending' }
  } };
const body = { guildId: guild, room: 'Test', link: 'https://www.haxball.com/play?c=test-room', reportedIp: ip, version: '0.1.1' };
test('matches all candidates, deduplicates Discords, checks only stored/confirmed data from authorized guilds', () => {
  const matches = findHostNetworkMatches(ip, store, scope.allowedGuild);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].userId, user);assert.equal(matches[0].sources.length, 2);
  assert.equal(matches[1].byIp, false);assert.equal(matches[1].byConnIp, true);
  assert.equal(findHostNetworkMatches('No disponible', store, scope.allowedGuild).length, 0);
  assert.equal(normalizeIp('::ffff:192.0.2.42'), ip);
  assert.equal(normalizeIp('2001:0db8:0000::1'), '2001:db8::1');
  assert(hostMatchField(ip, store, scope.allowedGuild, true).value.includes('no prueban'));
  assert(!hostMatchField(ip, store, scope.allowedGuild, false).value.includes(user));
});
function setup({ privateChannel = true, targetGuild = scope.TEST_GUILD, failSend = false, configured = true, linked = true, generalLinked = false, failGeneralOnce = false, matchStore = store } = {}) {
  const calls = [], messages = [], clock = { now: Date.now() };
  const client = { guilds: { cache: new Map([[guild, {}]]) }, channels: { fetch: async id => ({ guildId: id === 'local-channel' ? guild : id === 'general-channel' ? scope.TEST_GUILD : targetGuild,
    isTextBased: () => true, guild: { roles: { everyone: {} } }, permissionsFor: () => ({ has: () => !privateChannel }),
    send: async payload => { if (id === 'general-channel' && failGeneralOnce) { failGeneralOnce = false; throw Error('temporary'); } messages.push({ id, payload }); }
  }) } };
  const send = createHostReporter({ client, readStore: () => matchStore, now: () => clock.now,
    readConfigForGuild: g => g === guild && linked ? { validationChannelId: 'local-channel' } : g === scope.TEST_GUILD && generalLinked ? { validationChannelId: 'general-channel' } : {},
    webhookUrl: () => configured ? 'https://discord.com/api/webhooks/123456789012345678/test-token' : '',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') return { ok: !failSend, status: failSend ? 500 : 200 };
      return { ok: true, json: async () => ({ type: 1, guild_id: targetGuild, channel_id: 'channel' }) };
    } });
  return { send, calls, clock, messages };
}
test('one webhook report at room creation, no public lookup results and no duplicate POST on retry/concurrency', async () => {
  const { send, calls, messages } = setup();
  const results = await Promise.all([send(body, guild, 'peer'), send(body, guild, 'peer')]);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
  assert(!JSON.stringify(results).includes(user));assert(!JSON.stringify(results).includes(ip));
  const payload = JSON.parse(calls.find(c => c.options.method === 'POST').options.body);
  assert.deepEqual(payload.allowed_mentions.parse, []);
  assert(JSON.stringify(payload).includes(ip));assert(JSON.stringify(payload).includes(user));
  assert(JSON.stringify(payload).includes(conn));assert(JSON.stringify(payload).includes('No disponibles'));
  assert.equal(messages.length, 1);assert.equal(messages[0].id, 'local-channel');
  const summary = JSON.stringify(messages[0].payload);
  assert(summary.includes(user));assert(summary.includes(user2));assert(summary.includes('Varias cuentas coinciden'));
  assert(!summary.includes(ip));assert(!summary.includes(conn));assert(!summary.includes('Contexto del host'));
});
test('public webhook channel masks host IP and all matching Discord IDs', async () => {
  const { send, calls, messages } = setup({ privateChannel: false });await send(body, guild, 'peer');
  const json = calls.find(c => c.options.method === 'POST').options.body;
  assert(!json.includes(ip));assert(!json.includes(user));assert(!json.includes(conn));
  assert(!JSON.stringify(messages).includes(user));
});
test('failures do not mark a room sent; missing config, foreign guild and invalid links are rejected', async () => {
  const { send, calls, messages } = setup({ failSend: true });
  await assert.rejects(send(body, guild, 'peer'), /HOST_WEBHOOK_SEND_FAILED/);
  await assert.rejects(send(body, guild, 'peer'), /HOST_WEBHOOK_SEND_FAILED/);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 2);
  assert.equal(messages.length, 1, 'webhook retries do not repeat the linked-channel message');
  await assert.rejects(setup({ linked: false }).send(body, guild), /HOST_VALIDATION_CHANNEL_NOT_CONFIGURED/);
  await assert.rejects(setup({ targetGuild: other }).send(body, guild), /HOST_WEBHOOK_LEAGUE_MISMATCH/);
  for (const link of ['https://evil.example/play?c=test', 'http://www.haxball.com/play?c=test', 'https://user:pw@www.haxball.com/play?c=test']) assert.throws(() => parseHostReport({ ...body, link }, guild));
  assert.throws(() => parseHostReport(body, other));
});
test('vinvalidaciones summary works without webhook and supports optional general copy with per-channel retries', async () => {
  const { send, calls, messages } = setup({ configured: false, generalLinked: true, failGeneralOnce: true });
  await assert.rejects(send(body, guild), /temporary/);
  await send(body, guild);await send(body, guild);
  assert.deepEqual(messages.map(m => m.id), ['local-channel', 'general-channel']);
  assert.equal(calls.length, 0, 'no webhook is required for channel delivery');
});
test('single candidate is tentative; no matches or missing IP are explicit', async () => {
  for (const [matchStore, reportedIp, expected] of [
    [{ linksByGuild: { [guild]: { [user]: { links: [{ ip }] } } } }, ip, 'Posible hoster'],
    [{}, ip, 'Sin coincidencias'], [{}, null, 'No identificado']
  ]) {
    const { send, messages } = setup({ configured: false, matchStore });
    await send({ ...body, reportedIp }, guild);
    assert(JSON.stringify(messages).includes(expected));
    assert(!JSON.stringify(messages).includes('198.51.100.20'));
  }
});
test('bounded bodies and per-peer rate limits; retry window expires', async () => {
  await assert.rejects(readHostBody(Readable.from([Buffer.alloc(5000)])), /HOST_REPORT_TOO_LARGE/);
  await assert.rejects(readHostBody(Readable.from([Buffer.from('{bad')])), /INVALID_JSON/);
  assert.deepEqual(await readHostBody(Readable.from([Buffer.from(JSON.stringify(body))])), body);
  const { send, clock } = setup();
  for (let i = 0; i < 12; i++) await send(body, guild, 'peer');
  await assert.rejects(send(body, guild, 'peer'), /HOST_REPORT_RATE_LIMIT/);
  clock.now += 60001;await send(body, guild, 'peer');
});
test('room password is reported only in private linked channels, never admin credentials, webhook or public response', async () => {
  for (const roomPassword of ['ASH#2k26', 'room-secret', '', undefined]) {
    const { send, messages, calls } = setup({ generalLinked: true });
    const result = await send({ ...body, ...(roomPassword !== undefined ? { roomPassword } : {}), adminPass: 'ADMIN_SECRET', ownerPassword: 'OWNER_SECRET' }, guild);
    assert.equal(messages.length, 2);
    for (const message of messages) {
      const field = message.payload.embeds[0].fields.find(f => f.name === 'Contraseña de la sala');
      const expected = roomPassword === undefined ? 'No informada (script anterior).' : roomPassword === '' ? 'Sin contraseña' : 'Sí: ' + require('discord.js').escapeMarkdown(roomPassword);
      assert.equal(field.value, expected);
    }
    assert.deepEqual(result, { ok: true });
    const serialized = JSON.stringify({ messages, calls });
    assert(!serialized.includes('ADMIN_SECRET'));assert(!serialized.includes('OWNER_SECRET'));
    const webhook = JSON.parse(calls.find(c => c.options.method === 'POST').options.body);
    assert(!webhook.embeds[0].fields.some(f => f.name === 'Contraseña de la sala'));
  }
  const { send, messages } = setup({ privateChannel: false, configured: false });
  await send({ ...body, roomPassword: 'PRIVATE_ROOM_PASSWORD' }, guild);
  assert(!JSON.stringify(messages).includes('PRIVATE_ROOM_PASSWORD'));
  assert(JSON.stringify(messages).includes('Sí (oculta'));
  for (const roomPassword of [true, {}, 'x'.repeat(257)]) assert.throws(() => parseHostReport({ ...body, roomPassword }, guild), /INVALID_ROOM_PASSWORD/);
});
