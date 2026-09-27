const path = require('node:path');
const { createService } = require('./kyu-backend/server.cjs');
const { commands } = require('./kyu-backend/commands.cjs');
const names = new Set(commands.map(c => c.name));
const KYU_GUILD_ID = '1510011417712132117';

function configuration(env = process.env) {
  const publicUrl = (env.KYU_PUBLIC_URL || env.PUBLIC_URL || '').replace(/\/+$/, '');
  let validUrl = false;
  try { const u = new URL(publicUrl); validUrl = u.protocol === 'https:' && u.origin === publicUrl; } catch {}
  const mapped = {
    DISCORD_CLIENT_ID: env.CLIENT_ID || env.DISCORD_CLIENT_ID || '',
    DISCORD_BOT_TOKEN: env.TOKEN || env.DISCORD_BOT_TOKEN || '',
    DISCORD_CLIENT_SECRET: env.KYU_CLIENT_SECRET || env.DISCORD_CLIENT_SECRET || '',
    DISCORD_PUBLIC_KEY: env.DISCORD_PUBLIC_KEY || '',
    DISCORD_GUILD_ID: env.KYU_GUILD_ID || env.DISCORD_GUILD_ID || KYU_GUILD_ID,
    PUBLIC_URL: validUrl ? publicUrl : '',
    KYU_PLAYER_ROLE_ID: env.KYU_PLAYER_ROLE_ID || '',
    KYU_PRO_ROLE_ID: env.KYU_PRO_ROLE_ID || '',
    KYU_PRO_PLUS_ROLE_ID: env.KYU_PRO_PLUS_ROLE_ID || '',
    KYU_STREAMER_ROLE_IDS: env.KYU_STREAMER_ROLE_IDS || '',
    KYU_STAFF_ROLE_ID: env.KYU_STAFF_ROLE_ID || '',
    DATA_FILE: env.KYU_DATA_FILE || path.resolve(__dirname, '../data/kyu-app.json')
  };
  return { enabled: env.KYU_ENABLED === '1', publicUrl, validUrl, env: mapped };
}

function createIntegration(env = process.env, transport = fetch) {
  const config = configuration(env);
  let service, timer;
  function getService() { return service || (service = createService(config.env, transport)); }
  function isGuild(id) { return config.enabled && !!config.env.DISCORD_GUILD_ID && String(id) === config.env.DISCORD_GUILD_ID; }
  // Membership is independent of OAuth activation: keep the owner's server
  // while credentials are being configured, without granting league/access rights.
  function canStayInGuild(id) { return String(id) === KYU_GUILD_ID || isGuild(id); }
  function route(req, res) {
    const route = new URL(req.url || '/', 'http://localhost').pathname;
    if (!['/health', '/kyu/health', '/auth/start', '/auth/callback'].includes(route) && !route.startsWith('/v1/')) return false;
    if (!config.enabled) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, configured: false, error: 'KyuApp no está activado en este bot. Configurá KYU_ENABLED=1 y las variables de acceso.' }));
      return true;
    }
    if (route === '/kyu/health') req.url = '/health';
    // Reuse the existing web listener/PORT. Do not open a competing HTTP server.
    getService().server.emit('request', req, res);
    return true;
  }
  function start() {
    if (!config.enabled || timer) return;
    getService();
    timer = setInterval(() => getService().tick().catch(() => console.error('[KyuApp] No se pudo actualizar planes/presencia.')), 30000);
    timer.unref();
  }
  function handles(i) { return names.has(i.commandName) && i.isChatInputCommand?.() || i.customId === 'kyu:ticket' && i.isStringSelectMenu?.(); }
  async function interaction(i) {
    if (!handles(i)) return false;
    if (!isGuild(i.guildId || i.guild?.id)) {
      await i.reply({ content: 'KyuApp no está habilitado en este servidor.', flags: 64 });
      return true;
    }
    await i.deferReply({ flags: 64 });
    try {
      const raw = {
        type: i.isChatInputCommand?.() ? 2 : 3,
        guild_id: i.guildId || i.guild.id,
        channel_id: i.channelId,
        member: {
          user: { id: i.user.id },
          permissions: String(i.memberPermissions?.bitfield || 0),
          roles: i.member?.roles?.cache ? [...i.member.roles.cache.keys()] : i.member?.roles || []
        },
        data: { name: i.commandName, options: (i.options?.data || []).map(o => ({ name: o.name, value: o.value })), custom_id: i.customId, values: i.values }
      };
      await i.editReply({ ...await getService().command(raw), allowedMentions: { parse: [] } });
    } catch (error) {
      await i.editReply({ content: error.message || 'No se pudo completar la acción de KyuApp.', allowedMentions: { parse: [] } });
    }
    return true;
  }
  return { config, route, isGuild, canStayInGuild, start, handles, interaction, commandsFor: id => isGuild(id) ? commands : [], close() { clearInterval(timer); timer = null; } };
}
let instance;
const current = () => instance || (instance = createIntegration());
module.exports = { configuration, createIntegration, route: (...a) => current().route(...a), isGuild: id => current().isGuild(id), canStayInGuild: id => current().canStayInGuild(id), start: () => current().start(), handles: i => current().handles(i), interaction: i => current().interaction(i), commandsFor: id => current().commandsFor(id) };
