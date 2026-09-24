const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const { readConfig, saveConfig, removeUserClubAffiliation, upsertUserClubAffiliation, addHistory } = require("./database");
const clubs = require("./clubs");
const roleRegistry = require("./roleRegistry");
const validators = require("./validators");
const nicknames = require("./nicknames");
const market = require("./market");
const { updateLinkedForumTemplates } = require("./plantillas");
const { isCaptain } = require("./clubPermissions");
const divisions = require("./divisions");
const haxoleSupabase = require("./haxoleSupabase");
const { withRoleLimitLock } = require("./roleLimitLock");

const CHECK_EMOJI = "\u2705";
const REJECT_EMOJI = "\u274C";
const TRANSFER_TTL_MS = 22 * 60 * 60 * 1000;
const TRANSFER_BUTTON_PREFIX = "transfer";

const getClubEmoji = (clubName) => {
  const clubEntry = clubs.findClub(clubName);
  return clubEntry?.emoji || `:${String(clubName || "Club").replace(/\s+/g, "")}:`;
};

const ensureBucket = (cfg) => {
  if (!cfg.pendingTransfers || typeof cfg.pendingTransfers !== "object" || Array.isArray(cfg.pendingTransfers)) {
    cfg.pendingTransfers = {};
  }
  return cfg.pendingTransfers;
};

const getPendingTransfer = (messageId) => {
  const cfg = readConfig();
  return cfg.pendingTransfers?.[messageId] || null;
};

const updatePendingTransfer = (messageId, patch = {}) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg);
  if (!bucket[messageId]) return null;
  bucket[messageId] = {
    ...bucket[messageId],
    ...patch
  };
  saveConfig(cfg);
  return bucket[messageId];
};

const buildTransferPrompt = ({ memberId, fromClub, toClub, isCaptainTransfer }) => {
  if (isCaptainTransfer) {
    return [
      `<@${memberId}> ya tenes club en esta modalidad y sos Capitan.`,
      "Cede capitania para poder firmar para este club y despues toca **Aceptar**."
    ].join("\n");
  }

  return [
    `<@${memberId}> ${getClubEmoji(fromClub)} >>>> ${getClubEmoji(toClub)}`,
    "ya tenes club en esta modalidad.",
    "Toca **Aceptar** para aprobar el cambio o **Rechazar** para cancelarlo."
  ].join("\n");
};

const transferActionRow = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`${TRANSFER_BUTTON_PREFIX}:accept`)
    .setLabel("Aceptar")
    .setEmoji(CHECK_EMOJI)
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled),
  new ButtonBuilder()
    .setCustomId(`${TRANSFER_BUTTON_PREFIX}:reject`)
    .setLabel("Rechazar")
    .setEmoji(REJECT_EMOJI)
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled)
);

const transferPromptPayload = (content, disabled = false) => {
  const embed = new EmbedBuilder()
    .setTitle("Confirmacion de traspaso")
    .setDescription(content)
    .setColor(0xb0091c);

  return {
    embeds: [embed],
    components: [transferActionRow(disabled)],
    allowedMentions: { users: [String(content.match(/<@(\d+)>/)?.[1] || "")].filter(Boolean) }
  };
};

const dmTransferNotice = async ({ member, requester, fromClub, toClub, channel, promptMessage }) => {
  const channelLink = channel?.url || (channel?.id ? `https://discord.com/channels/${channel.guildId || channel.guild?.id}/${channel.id}` : null);
  const messageLink = promptMessage?.url || null;
  const lines = [
    `Hola, ${member}.`,
    "",
    `**${requester?.tag || requester?.username || "Un capitan"}** te intento fichar para **${toClub}**, pero ya estas en **${fromClub}**.`,
    "",
    "Para aceptar el cambio, toca el boton **Aceptar** en el mensaje donde te etiquetaron.",
    messageLink ? `Mensaje: ${messageLink}` : null,
    channelLink ? `Foro: ${channelLink}` : null,
    "",
    "Al aceptar, el bot te cancela del club anterior y te ficha en el nuevo automaticamente."
  ].filter(Boolean);

  await member.send({ content: lines.join("\n") }).catch(() => null);
};

const createPendingTransfer = async (interaction, member, { fromClub, fromRoleId, toClub, toRoleId, modality, isCaptainTransfer = false }) => {
  const content = buildTransferPrompt({
    memberId: member.id,
    fromClub,
    toClub,
    isCaptainTransfer
  });

  const prompt = await interaction.channel?.send(transferPromptPayload(content)).catch(async () =>
    interaction.channel?.send({ content }).catch(() => null)
  );
  if (!prompt) return null;

  const cfg = readConfig();
  const bucket = ensureBucket(cfg);
  for (const [existingId, existing] of Object.entries(bucket)) {
    if (String(existing?.guildId || "") !== String(interaction.guild.id)) continue;
    if (String(existing?.userId || "") !== String(member.id)) continue;
    delete bucket[existingId];
  }
  bucket[prompt.id] = {
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    messageId: prompt.id,
    userId: member.id,
    fromClub,
    fromRoleId,
    toClub,
    toRoleId,
    modality,
    requestedBy: interaction.user.id,
    requestedByTag: interaction.user.tag,
    isCaptainTransfer,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TRANSFER_TTL_MS).toISOString()
  };
  saveConfig(cfg);

  await dmTransferNotice({
    member,
    requester: interaction.user,
    fromClub,
    toClub,
    channel: interaction.channel,
    promptMessage: prompt
  });

  return prompt;
};

const deletePendingTransfer = (messageId) => {
  const cfg = readConfig();
  if (!cfg.pendingTransfers?.[messageId]) return;
  delete cfg.pendingTransfers[messageId];
  saveConfig(cfg);
};

const pruneExpiredTransfers = () => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg);
  const now = Date.now();
  let changed = false;
  for (const [messageId, transfer] of Object.entries(bucket)) {
    if (transfer.expiresAt && new Date(transfer.expiresAt).getTime() < now) {
      delete bucket[messageId];
      changed = true;
    }
  }
  if (changed) saveConfig(cfg);
};

const pruneExpiredTransferMessages = async (client) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg);
  const now = Date.now();
  let changed = false;

  for (const [messageId, transfer] of Object.entries(bucket)) {
    if (!transfer.expiresAt || new Date(transfer.expiresAt).getTime() >= now) continue;

    const guild = await client.guilds.fetch(transfer.guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(transfer.channelId).catch(() => null) : null;
    const message = channel?.messages?.fetch
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    await message?.delete?.().catch(() => null);
    delete bucket[messageId];
    changed = true;
  }

  if (changed) saveConfig(cfg);
};

const applyPendingTransfer = async (client, messageId, reactingUserId) => {
  const transfer = getPendingTransfer(messageId);
  const fail = (reason) => ({ ok: false, reason });

  if (!transfer) return fail("missing");
  if (String(transfer.userId) !== String(reactingUserId)) return fail("not_authorized");
  if (transfer.status === "processing" && String(transfer.processingBy || "") === String(reactingUserId)) {
    return fail("processing");
  }
  if (transfer.status && transfer.status !== "pending") return fail("not_pending");

  const claimed = updatePendingTransfer(messageId, {
    status: "processing",
    processingBy: reactingUserId,
    processingAt: new Date().toISOString()
  });
  if (!claimed || claimed.status !== "processing") return fail("not_pending");

  try {
    if (transfer.expiresAt && new Date(transfer.expiresAt).getTime() < Date.now()) {
      deletePendingTransfer(messageId);
      return fail("expired");
    }

    const guild = await client.guilds.fetch(transfer.guildId).catch(() => null);
    if (!guild) {
      deletePendingTransfer(messageId);
      return fail("guild_missing");
    }
    const member = await guild.members.fetch(transfer.userId).catch(() => null);
    if (!member) {
      deletePendingTransfer(messageId);
      return fail("member_missing");
    }

    const mod = roleRegistry.normalizeModality(transfer.modality);
    const toClubEntry = clubs.findClub(transfer.toClub);
    if (!mod || !toClubEntry) {
      deletePendingTransfer(messageId);
      return fail("invalid_target");
    }

    if (isCaptain(readConfig(), transfer.fromClub, mod, member.id)) {
      const channel = await guild.channels.fetch(transfer.channelId).catch(() => null);
      await channel?.send({
        content: `<@${member.id}> todavia figuras como CAP en **${transfer.fromClub} ${mod}**. Cede capitania y volve a tocar **Aceptar**.`
      }).catch(() => null);
      updatePendingTransfer(messageId, { status: "pending", processingBy: null, processingAt: null });
      return fail("captain_blocked");
    }

    return await withRoleLimitLock(guild.id, transfer.toRoleId, async () => {
    const roleLimit = validators.getRoleLimit(transfer.toRoleId, mod);
    if (roleLimit) {
      const role = await guild.roles.fetch(transfer.toRoleId).catch(() => null);
      let allMembers;
      try {
        allMembers = await guild.members.fetch({ force: true, time: 30000 });
        if (!allMembers?.size || (guild.memberCount && allMembers.size < guild.memberCount)) throw new Error("lista incompleta");
      } catch {
        updatePendingTransfer(messageId, { status: "pending", processingBy: null, processingAt: null });
        return fail("members_unavailable");
      }
      if (!role) {
        updatePendingTransfer(messageId, { status: "pending", processingBy: null, processingAt: null });
        return fail("target_role_missing");
      }
      const currentCount = Array.from(allMembers.values()).filter((entry) => entry.roles.cache.has(transfer.toRoleId)).length;
      const alreadyInTarget = member.roles.cache.has(transfer.toRoleId);
      if (!alreadyInTarget && currentCount >= roleLimit) {
        const channel = await guild.channels.fetch(transfer.channelId).catch(() => null);
        await channel?.send({
          content: `<@${member.id}> no pude completar el cambio a **${transfer.toClub} ${mod}** porque la plantilla ya llego al limite **${roleLimit}/${roleLimit}**.`
        }).catch(() => null);
        updatePendingTransfer(messageId, { status: "pending", processingBy: null, processingAt: null });
        return fail("role_limit");
      }
    }

    const allowance = market.checkSigningAllowance({ club: transfer.toClub, modality: mod, amount: 1 });
    if (!allowance.ok) {
      const channel = await guild.channels.fetch(transfer.channelId).catch(() => null);
      await channel?.send({ content: `<@${member.id}> ${allowance.message}` }).catch(() => null);
      updatePendingTransfer(messageId, { status: "pending", processingBy: null, processingAt: null });
      return fail("market_closed");
    }

    if (transfer.fromRoleId && member.roles.cache.has(transfer.fromRoleId)) {
      await member.roles.remove(transfer.fromRoleId, "Transferencia aprobada por boton").catch(() => null);
    }
    await member.roles.add(transfer.toRoleId, "Transferencia aprobada por boton");

    removeUserClubAffiliation(member.id, { club: transfer.fromClub, modality: mod, roleId: transfer.fromRoleId });
    upsertUserClubAffiliation(member.id, {
      club: transfer.toClub,
      abbr: toClubEntry.abbr,
      modality: mod,
      roleId: transfer.toRoleId,
      by: transfer.requestedByTag || "transferencia"
    });
    const modalityRow = await haxoleSupabase.getModalidadRow(mod).catch(() => null);
    await haxoleSupabase.upsertPlayerIdentity({
      guildId: guild.id,
      discordUserId: member.id,
      discordUsername: member.user.tag,
      discordAvatarUrl: member.displayAvatarURL({ size: 128 }),
      haxballName: member.displayName,
      clubId: await haxoleSupabase.getClubIdByName(transfer.toClub).catch(() => null),
      clubName: transfer.toClub,
      modalidadId: modalityRow?.id || null,
      modalidadName: mod,
      source: "transfer"
    }).catch(() => null);
    addHistory(member.id, "CANCELAR", { modality: mod, club: transfer.fromClub, by: member.user.tag, reason: "Transferencia aprobada por boton" });
    addHistory(member.id, "FICHO", { modality: mod, club: transfer.toClub, by: transfer.requestedByTag || "transferencia" });
    await divisions.syncMemberDivisionRoles(guild, member, readConfig(), mod, { ensure: true });
    market.registerSignings({ club: transfer.toClub, modality: mod, amount: 1 });

    await nicknames.updateNickname(member).catch(() => null);
    await updateLinkedForumTemplates(guild, transfer.fromClub, mod).catch(() => null);
    await updateLinkedForumTemplates(guild, transfer.toClub, mod).catch(() => null);

    deletePendingTransfer(messageId);

    const channel = await guild.channels.fetch(transfer.channelId).catch(() => null);
    await channel?.send({
      content: `${CHECK_EMOJI} <@${member.id}> cambio aprobado: **${transfer.fromClub} ${mod}** >>> **${transfer.toClub} ${mod}**.`
    }).catch(() => null);

    return { ok: true };
    });
  } catch (error) {
    console.error("[transfers] Error aplicando transferencia:", error);
    updatePendingTransfer(messageId, { status: "pending", processingBy: null, processingAt: null });
    return fail("error");
  }
};

const rejectPendingTransfer = async (client, messageId, reactingUserId) => {
  const transfer = getPendingTransfer(messageId);
  if (!transfer || String(transfer.userId) !== String(reactingUserId)) return false;

  const guild = await client.guilds.fetch(transfer.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(transfer.channelId).catch(() => null) : null;
  const message = channel?.messages?.fetch
    ? await channel.messages.fetch(messageId).catch(() => null)
    : null;

  deletePendingTransfer(messageId);
  await message?.delete?.().catch(() => null);
  return true;
};

module.exports = {
  CHECK_EMOJI,
  REJECT_EMOJI,
  TRANSFER_TTL_MS,
  TRANSFER_BUTTON_PREFIX,
  createPendingTransfer,
  applyPendingTransfer,
  rejectPendingTransfer,
  transferPromptPayload,
  pruneExpiredTransfers,
  pruneExpiredTransferMessages
};
