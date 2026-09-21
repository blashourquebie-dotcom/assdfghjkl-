const { EmbedBuilder } = require("discord.js");
const { sendAlert } = require("../utils/alerts");
const officials = require("../utils/officials");
const validarauth = require("../commands/validarauth");

const validationLocks = new Set();

const parseField = (embed, name) => {
  const field = embed?.fields?.find((entry) => String(entry.name || "").toLowerCase() === String(name || "").toLowerCase());
  return field ? String(field.value || "").trim() : null;
};

const parseOfficialLog = (message) => {
  const embed = message?.embeds?.[0];
  if (!embed) return null;

  const title = String(embed.title || "");
  const isOfficial =
    (/haxole/i.test(title) && /vs/i.test(title)) ||
    /validacion oficial/i.test(title) ||
    /entrada a la sala/i.test(title) ||
    /^entry$/i.test(title);

  if (!isOfficial) return null;

  return {
    room: title,
    playerName: parseField(embed, "Jugador") || parseField(embed, "Nombre"),
    auth: parseField(embed, "Auth"),
    conn: parseField(embed, "Conn"),
    ip: parseField(embed, "IP"),
    mode: parseField(embed, "Modalidad"),
    official: parseField(embed, "Oficial"),
    validationId:
      parseField(embed, "Validation ID") ||
      parseField(embed, "ValidationId") ||
      parseField(embed, "ID validacion") ||
      parseField(embed, "Id validacion")
  };
};

const buildValidationEmbed = (payload) =>
  new EmbedBuilder()
    .setColor(0xb0091c)
    .setTitle("🔐 Verificación HaxBall")
    .setDescription([
      `Se requiere verificación para acceder a la sala **${payload.room || "desconocida"}**.`,
      "",
      "¿Confirmas que eres tú intentando unirte a la sala?",
      "",
      "**Auth de HaxBall**",
      `\`${payload.auth || "No disponible"}\``,
      "**Sala**",
      `${payload.room || "No disponible"}`,
      "**Usuario**",
      `${payload.playerName}`,
      "",
      "Esta verificación expira en 5 minutos."
    ].join("\n"));

const processOfficialPayload = async (client, payload, context = {}) => {
  if (!client || !payload?.playerName) return null;

  const cleanValidationId = String(payload.validationId || "").trim();
  const lockKey=String(context.guildId||'')+':'+cleanValidationId;
  if (!cleanValidationId) {
    return { match: null, session: null, skipped: true, reason: "no-validation-id" };
  }
  if (cleanValidationId && validationLocks.has(lockKey)) {
    return { match: null, session: null, skipped: true, reason: "locked" };
  }
  if (cleanValidationId) validationLocks.add(lockKey);

  try {
    const store = officials.readStore();
    const requestedGuildId = String(context.guildId || "").trim();
    const knownGuildIds = Object.keys(store.linksByGuild || {});
    if (!requestedGuildId && knownGuildIds.length !== 1) return { skipped: true, reason: "guild-required" };
    const guildIds = requestedGuildId ? [requestedGuildId] : knownGuildIds;

    let match = null;
    let matchedGuildId = requestedGuildId || null;

    for (const guildId of guildIds) {
      const found = officials.findLinkedDiscord({
        guildId,
        auth: payload.auth,
        conn: payload.conn,
        ip: payload.ip
      });
      if (found) {
        match = found;
        matchedGuildId = guildId;
        break;
      }
    }

    const sessionGuildId = matchedGuildId || requestedGuildId || guildIds[0] || "global";
    if (!require('../utils/tournamentScope').allowedGuild(sessionGuildId)) return { skipped: true, reason: 'guild-not-allowed' };
    // Public player identities are updated only after Discord confirmation (antiDu.recordValidation).

    const session = cleanValidationId
      ? officials.upsertPendingSession({
          validationId: cleanValidationId,
          guildId: sessionGuildId,
          channelId: context.channelId || "api",
          messageId: context.messageId || null,
          playerName: payload.playerName,
          auth: payload.auth,
          conn: payload.conn,
          ip: payload.ip,
          matchedUserId: match?.userId || null,
          matchedBy: match?.reason || null,
          source: context.source || "webhook",
          mode: payload.mode,
          official: payload.official,
          room: payload.room
        })
      : officials.createPendingSession({
          guildId: sessionGuildId,
          channelId: context.channelId || "api",
          messageId: context.messageId || null,
          validationId: null,
          playerName: payload.playerName,
          auth: payload.auth,
          conn: payload.conn,
          ip: payload.ip,
          matchedUserId: match?.userId || null,
          matchedBy: match?.reason || null,
          source: context.source || "webhook",
          mode: payload.mode,
          official: payload.official,
          room: payload.room
        });

    if (!session) return { match, session: null, skipped: true };
    if (session.status === 'pending' && !session.hostContext && payload.hostContext) {
      const hostContext = require('../utils/hostValidationContext').normalizeHostContext(payload.hostContext);
      officials.updatePendingSession(session.id, { hostContext });
      session.hostContext = hostContext;
    }
    if(session.status==='pending'&&payload.autoValidation===true)officials.updatePendingSession(session.id,{autoValidationRequested:true});
    const antiDu=require('../utils/antiDu');
    if(session.status==='confirmed'){
      void antiDu.recordValidation(client,session).catch(error=>console.error('[antiDu]',error.message));
      return {match,session,skipped:true};
    }
    if(payload.autoValidation===true&&session.status==='pending'){
      const reuse=antiDu.autoValidation(session);
      if(reuse){
        Object.assign(session,officials.updatePendingSession(session.id,{status:'confirmed',reportingV2:true,confirmedAt:new Date().toISOString(),manualConfirmedAt:reuse.manualConfirmedAt,automatic:true,decidedBy:session.matchedUserId}));
        officials.addPlayerAlias({guildId:session.guildId,userId:session.matchedUserId,playerName:session.playerName,source:'auto-validation'});
        // The confirmed state is saved first. Staff reports/profile sync must not
        // delay admission; retryReports retries delivery if a service fails.
        void antiDu.recordValidation(client,session).catch(error=>console.error('[antiDu]',error.message));
        return {match,session,automatic:true};
      }
    }
    if (session.notifyingAt || session.notifiedAt) {
      return { match, session, skipped: true };
    }

    officials.updatePendingSession(session.id, { notifyingAt: new Date().toISOString() });

    const guild = matchedGuildId ? await client.guilds.fetch(matchedGuildId).catch(() => null) : null;

    if (match?.userId) {
      const user = await client.users.fetch(match.userId).catch(() => null);
      if (user) {
        const components = validarauth.buildValidationComponents(session.id);
        await user.send({ embeds: [buildValidationEmbed(payload)], components }).then(() => {
          officials.updatePendingSession(session.id, {
            notifiedAt: new Date().toISOString(),
            notifyingAt: null
          });
          console.log("[webhookHandler] DM enviado:", { userId: match.userId, playerName: payload.playerName, sessionId: session.id });
        }).catch(async () => {
          officials.updatePendingSession(session.id, { notifyingAt: null });
          console.log("[webhookHandler] DM falló:", { userId: match.userId, playerName: payload.playerName, sessionId: session.id });
          if (guild) {
            await sendAlert(guild, {
              embeds: [{
                title: "Validacion oficial sin DM",
                description: `<@${match.userId}> no recibio DM para validar **${payload.playerName}**.`,
                color: 0xe67e22
              }]
            }).catch(() => null);
          }
        });
      } else {
        officials.updatePendingSession(session.id, { notifyingAt: null });
      }
    } else {
      officials.updatePendingSession(session.id, { notifyingAt: null });
      if (guild) {
        await sendAlert(guild, {
          embeds: [{
            title: "Ingreso oficial sin vinculo",
            description: [
              `Jugador detectado: **${payload.playerName}**`,
              payload.auth ? `Auth: \`${payload.auth}\`` : null,
              payload.conn ? `Conn: \`${payload.conn}\`` : null,
              payload.ip ? `IP: \`${payload.ip}\`` : null,
              "No encontre un Discord vinculado para este ingreso."
            ].filter(Boolean).join("\n"),
            color: 0xe67e22
          }]
        }).catch(() => null);
      }
      console.log("[webhookHandler] sin vinculo:", { playerName: payload.playerName, auth: payload.auth || null });
    }

    return { match, session, skipped: false, guildId: sessionGuildId };
  } finally {
    if (cleanValidationId) validationLocks.delete(lockKey);
  }
};

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (!require('../utils/tournamentScope').allowedGuild(message.guild?.id)) return;
    if (!message.webhookId || !message.guild) return;
    const payload = parseOfficialLog(message);
    if (!payload?.playerName) return;

    console.log("[webhookHandler] webhook oficial detectado:", {
      guildId: message.guild.id,
      room: payload.room,
      playerName: payload.playerName,
      validationId: payload.validationId || null
    });

    await processOfficialPayload(client, payload, {
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      source: /validacion oficial/i.test(payload.room) ? "haxheadless-validation" : "webhook-log"
    });
  });
};

module.exports.parseOfficialLog = parseOfficialLog;
module.exports.processOfficialPayload = processOfficialPayload;
