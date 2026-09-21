const crypto = require('node:crypto');
const { normalizeIp, hostMatchField, findHostNetworkMatches } = require('./hostNetworkMatches');
const scope = require('./tournamentScope');
const { escapeMarkdown } = require('discord.js');

function problem(status, code) { return Object.assign(new Error(code), { status, code }); }
function parseHostReport(body, guildId) {
  if (!body || typeof body !== 'object' || String(body.guildId) !== guildId) throw problem(400, 'INVALID_HOST_REPORT');
  if (body.roomPassword !== undefined && (typeof body.roomPassword !== 'string' || body.roomPassword.length > 256)) throw problem(400, 'INVALID_ROOM_PASSWORD');
  let url;
  try { url = new URL(body.link); } catch { throw problem(400, 'INVALID_ROOM_LINK'); }
  if (url.protocol !== 'https:' || !['www.haxball.com', 'haxball.com', 'html5.haxball.com'].includes(url.hostname) ||
      url.pathname !== '/play' || url.port || url.username || url.password || !/^[\w-]{3,128}$/.test(url.searchParams.get('c') || '')) throw problem(400, 'INVALID_ROOM_LINK');
  return {
    guildId,
    link: `https://www.haxball.com/play?c=${url.searchParams.get('c')}`,
    room: String(body.room || 'Sala oficial').replace(/[\r\n]/g, ' ').slice(0, 150),
    version: String(body.version || '').slice(0, 24),
    reportedIp: normalizeIp(body.reportedIp),
    roomPassword: typeof body.roomPassword === 'string' ? body.roomPassword : null
  };
}

function passwordField(report, privateChannel) {
  if (report.roomPassword === null) return { name: 'Contraseña de la sala', value: 'No informada (script anterior).' };
  if (report.roomPassword === '') return { name: 'Contraseña de la sala', value: 'Sin contraseña' };
  return { name: 'Contraseña de la sala', value: privateChannel ? 'Sí: ' + escapeMarkdown(report.roomPassword) : 'Sí (oculta: el canal debe ser privado).' };
}

function createHostReporter({ client, readStore, fetchImpl = fetch, webhookUrl = () => process.env.OFFICIAL_HOST_WEBHOOK_URL, now = Date.now,
  readConfigForGuild = guild => { const db = require('./database'); return db.withGuild(guild, db.readConfig); }
}) {
  const receipts = new Map(), buckets = new Map();
  let metadata = null, metadataUntil = 0;
  const minute = 60000, day = 86400000;
  function limit(key, maximum) {
    for (const [k, row] of buckets) if (row.until <= now()) buckets.delete(k);
    const row = buckets.get(key) || { count: 0, until: now() + minute };
    if (++row.count > maximum) throw problem(429, 'HOST_REPORT_RATE_LIMIT');
    buckets.set(key, row);
  }
  async function deliverWebhook(report) {
    const address = webhookUrl();
    if (!/^https:\/\/discord\.com\/api\/webhooks\/\d{17,20}\/[\w-]+$/.test(address || '')) throw problem(503, 'HOST_WEBHOOK_NOT_CONFIGURED');
    if (!metadata || metadataUntil <= now() || metadata.address !== address) {
      const response = await fetchImpl(address, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw problem(502, 'HOST_WEBHOOK_UNAVAILABLE');
      const hook = await response.json();
      if (hook.type !== 1 || !scope.allowedGuild(hook.guild_id)) throw problem(403, 'HOST_WEBHOOK_GUILD_DENIED');
      metadata = { address, guildId: hook.guild_id, channelId: hook.channel_id };
      metadataUntil = now() + 5 * minute;
    }
    if (metadata.guildId !== report.guildId && metadata.guildId !== scope.TEST_GUILD) throw problem(403, 'HOST_WEBHOOK_LEAGUE_MISMATCH');
    const channel = await client.channels.fetch(metadata.channelId);
    const privateChannel = channel?.guildId === metadata.guildId &&
      channel.permissionsFor?.(channel.guild?.roles?.everyone)?.has('ViewChannel') === false;
    const league = { ash: 'ASH', exclusivo: 'HAXOLE #ROADTOGLORY', tematico: 'HAXOLE #TEMÁTICO' }[scope.leagueForGuild(report.guildId)] || 'PRUEBAS';
    const embed = {
      title: 'Host creado · ' + league, color: 0x67d5f5,
      description: 'Datos enviados por la página que creó la sala. El owner y el creador pueden ser personas distintas.',
      fields: [
        { name: 'Sala', value: report.room || 'Sala oficial' },
        { name: 'Enlace', value: report.link },
        { name: 'IP pública del hoster (declarada)', value: report.reportedIp ? (privateChannel ? report.reportedIp : 'Oculta: el canal no es privado.') : 'No disponible' },
        { name: 'Conn / auth del hoster', value: 'No disponibles: Headless no los expone para el creador sin jugador. Las conns de abajo son registros previos, no una conn observada del hoster.' },
        hostMatchField(report.reportedIp, readStore(), scope.allowedGuild, privateChannel),
        { name: 'Versión', value: report.version || 'No disponible' }
      ],
      footer: { text: 'Coincidencia de red no confirma identidad. No concede owner ni valida jugadores.' },
      timestamp: new Date(now()).toISOString()
    };
    const response = await fetchImpl(address + '?wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw problem(response.status === 429 ? 429 : 502, 'HOST_WEBHOOK_SEND_FAILED');
  }
  async function deliver(report, receipt) {
    const localChannel = readConfigForGuild(report.guildId).validationChannelId;
    if (!localChannel) throw problem(503, 'HOST_VALIDATION_CHANNEL_NOT_CONFIGURED');
    const targets = [{ guild: report.guildId, channel: localChannel }];
    if (report.guildId !== scope.TEST_GUILD) {
      const generalChannel = readConfigForGuild(scope.TEST_GUILD).validationChannelId;
      if (generalChannel) targets.push({ guild: scope.TEST_GUILD, channel: generalChannel });
    }
    const matches = findHostNetworkMatches(report.reportedIp, readStore(), scope.allowedGuild);
    for (const target of targets) {
      const key = 'channel:' + target.channel;
      if (receipt.delivered.has(key)) continue;
      const channel = await client.channels.fetch(target.channel);
      if (channel?.guildId !== target.guild || !channel.isTextBased?.()) throw problem(403, 'HOST_VALIDATION_CHANNEL_INVALID');
      const privateChannel = channel.permissionsFor?.(channel.guild?.roles?.everyone)?.has('ViewChannel') === false;
      let identity = 'Sin coincidencias con un Discord vinculado.';
      if (!report.reportedIp) identity = 'No identificado: faltan datos de conexión.';
      else if (!privateChannel) identity = 'Coincidencias ocultas: el canal debe ser privado.';
      else if (matches.length === 1) identity = `Posible hoster: <@${matches[0].userId}>`;
      else if (matches.length > 1) identity = 'Varias cuentas coinciden: ' + matches.slice(0, 10).map(row => `<@${row.userId}>`).join(', ') +
        (matches.length > 10 ? ` (y ${matches.length - 10} más)` : '');
      const league = { ash: 'ASH', exclusivo: 'HAXOLE #ROADTOGLORY', tematico: 'HAXOLE #TEMÁTICO' }[scope.leagueForGuild(report.guildId)] || 'PRUEBAS';
      await channel.send({ embeds: [{ title: 'Sala creada · ' + league, color: 0x67d5f5,
        fields: [{ name: 'Sala', value: report.room }, { name: 'Enlace', value: report.link }, passwordField(report, privateChannel), { name: 'Discord del hoster', value: identity }],
        footer: { text: 'Coincidencia de conexión; no confirma identidad ni constituye una alerta DU.' }, timestamp: new Date(now()).toISOString()
      }], allowedMentions: { parse: [] } });
      receipt.delivered.add(key);
    }
    // Detailed webhook is optional; the linked channel does not require one.
    // Track deliveries separately so retrying a failed webhook cannot spam it.
    if (webhookUrl() && !receipt.delivered.has('webhook')) {
      await deliverWebhook(report);
      receipt.delivered.add('webhook');
    }
  }
  return async function report(body, guildId, remoteAddress = '') {
    if (!scope.allowedGuild(guildId) || !client.guilds.cache.has(guildId)) throw problem(403, 'HOST_GUILD_UNAVAILABLE');
    const report = parseHostReport(body, guildId);
    // Rate keys are hashes and use the actual peer, never an untrusted forwarding header.
    limit('global', 60);
    limit(crypto.createHash('sha256').update(remoteAddress).digest('hex'), 12);
    for (const [key, row] of receipts) if (row.until <= now()) receipts.delete(key);
    const key = guildId + ':' + report.link;
    let row = receipts.get(key);
    if (row?.complete || row?.pending) {
      if (row.pending) await row.pending;
      return { ok: true, duplicate: true };
    }
    if (!row && receipts.size >= 2000) throw problem(429, 'HOST_REPORT_CAPACITY');
    row ||= { until: now() + day, pending: null, delivered: new Set(), complete: false };
    receipts.set(key, row);
    row.pending = deliver(report, row);
    try { await row.pending; row.complete = true; }
    catch (error) { if (!row.delivered.size) receipts.delete(key); throw error; }
    finally { row.pending = null; }
    return { ok: true };
  };
}

function readHostBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], overflow = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) { overflow = true; chunks = []; reject(problem(413, 'HOST_REPORT_TOO_LARGE')); }
      else if (!overflow) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(problem(400, 'INVALID_JSON')); }
    });
    req.on('error', () => reject(problem(400, 'INVALID_HOST_REQUEST')));
  });
}
const reporters = new WeakMap();
async function handle(req, res, guildId, client, writeJson) {
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!reporters.has(client)) reporters.set(client, createHostReporter({ client, readStore: () => require('./officials').readStore() }));
  try {
    const result = await reporters.get(client)(await readHostBody(req), guildId, req.socket?.remoteAddress || '');
    return writeJson(res, 200, result); // Never return network data or Discord matches publicly.
  } catch (error) {
    const code = error.code?.startsWith?.('HOST_') || error.status ? error.code : 'HOST_REPORT_FAILED';
    console.warn('[host-report]', code); // No webhook token, body, IP or URL in console errors.
    return writeJson(res, error.status || 502, { error: code });
  }
}
module.exports = { createHostReporter, parseHostReport, readHostBody, handle };
