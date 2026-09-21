const { PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, readSanctions, saveSanctions, getUser, saveUser } = require("./database");
const roleRegistry = require("./roleRegistry");

const SANCTION_ROLE_NAME = "Sancionado";
const DURATION_RE = /^(\d+)\s*([sma])$/i;

const parseUserIds = (raw) => Array.from(new Set(String(raw || "")
  .match(/<@!?\d+>|\b\d{15,25}\b/g)
  ?.map((part) => part.match(/\d{15,25}/)?.[0])
  .filter(Boolean) || []));

const parseDuration = (raw) => {
  const match = String(raw || "").trim().match(DURATION_RE);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  const weeks = 7 * 24 * 60 * 60 * 1000;
  const months = 30 * 24 * 60 * 60 * 1000;
  const years = 365 * 24 * 60 * 60 * 1000;
  const multiplier = unit === "s" ? weeks : unit === "m" ? months : years;
  return {
    raw: `${amount}${unit}`,
    ms: amount * multiplier,
    label: `${amount} ${unit === "s" ? "semana(s)" : unit === "m" ? "mes(es)" : "año(s)"}`
  };
};

const parseModalities = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return [];

  return Array.from(new Set(
    value
      .split(",")
      .map((part) => roleRegistry.normalizeModality(part))
      .filter(Boolean)
  ));
};

const sanctionScopeKey = (userId, modality = null) =>
  modality ? `${userId}:${modality}` : String(userId);

const sanctionRoleName = (modality = null) =>
  modality ? `${SANCTION_ROLE_NAME} (${modality})` : SANCTION_ROLE_NAME;

const splitSanctionArgs = (raw, hasOptionalDuration = false) => {
  const userIds = parseUserIds(raw);
  const withoutUsers = String(raw || "").replace(/<@!?\d+>|\b\d{15,25}\b/g, " ").replace(/[,;]+/g, " ");
  const parts = withoutUsers.trim().split(/\s+/).filter(Boolean);
  let duration = null;
  let modalities = [];
  let rest = parts;

  if (parts.length && DURATION_RE.test(parts[0])) {
    duration = parseDuration(parts[0]);
    rest = parts.slice(1);
  } else if (!hasOptionalDuration) {
    duration = null;
  }

  return {
    userIds,
    duration,
    modalities,
    reason: rest.join(" ").trim()
  };
};

const canModerate = (interaction) => {
  return Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator));
};

const getOrCreateSanctionRole = async (guild, modality = null) => {
  const mod = roleRegistry.normalizeModality(modality);
  const cfg = readConfig();
  const guildEntry = cfg.sanctionedRoles?.[guild.id] || null;
  const savedRoleId = mod
    ? guildEntry?.modalities?.[mod]?.roleId
    : guildEntry?.general?.roleId || guildEntry?.roleId || guildEntry;
  const savedRole = savedRoleId ? await guild.roles.fetch(savedRoleId).catch(() => null) : null;
  if (savedRole) return savedRole;

  const wantedName = sanctionRoleName(mod);
  const existing = guild.roles.cache.find((role) => role.name.toLowerCase() === wantedName.toLowerCase());
  const role = existing || await guild.roles.create({
    name: wantedName,
    colors: { primaryColor: 0x2f3136 },
    reason: "Rol creado para /sancionar"
  });

  if (!cfg.sanctionedRoles || typeof cfg.sanctionedRoles !== "object") cfg.sanctionedRoles = {};
  if (!cfg.sanctionedRoles[guild.id] || typeof cfg.sanctionedRoles[guild.id] !== "object") {
    cfg.sanctionedRoles[guild.id] = {};
  }
  if (mod) {
    cfg.sanctionedRoles[guild.id].modalities = cfg.sanctionedRoles[guild.id].modalities || {};
    cfg.sanctionedRoles[guild.id].modalities[mod] = {
      roleId: role.id,
      updatedAt: new Date().toISOString()
    };
  } else {
    cfg.sanctionedRoles[guild.id].general = {
      roleId: role.id,
      updatedAt: new Date().toISOString()
    };
  }
  saveConfig(cfg);

  return role;
};

const ensureGuildBucket = (store, guildId) => {
  if (!store[guildId] || typeof store[guildId] !== "object") store[guildId] = {};
  return store[guildId];
};

const applySanction = async ({ interaction, userId, duration, reason, modality = null }) => {
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, line: `- <@${userId}> no esta en el servidor.` };

  const mod = roleRegistry.normalizeModality(modality);
  const role = await getOrCreateSanctionRole(interaction.guild, mod);
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role.id, `Sancionado por ${interaction.user.tag}: ${reason || "sin razon"}`);
  }

  const store = readSanctions();
  const guildBucket = ensureGuildBucket(store, interaction.guild.id);
  const now = Date.now();
  const entry = {
    userId,
    guildId: interaction.guild.id,
    roleId: role.id,
    modality: mod,
    reason: reason || "Sin razon",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + duration.ms).toISOString(),
    duration: duration.raw,
    by: interaction.user.id,
    byTag: interaction.user.tag
  };
  guildBucket[sanctionScopeKey(userId, mod)] = entry;
  saveSanctions(store);

  const user = getUser(userId);
  user.sanctions.push({ ...entry, action: "SANCIONAR" });
  saveUser(userId, user);

  const scopeText = mod ? ` en **${mod}**` : "";
  return { ok: true, line: `- <@${userId}> sancionado${scopeText} por **${duration.label}**. Expira <t:${Math.floor((now + duration.ms) / 1000)}:R>.` };
};

const clearSanction = async ({ interaction, userId, duration = null, modality = null }) => {
  const store = readSanctions();
  const guildBucket = ensureGuildBucket(store, interaction.guild.id);
  const mod = roleRegistry.normalizeModality(modality);
  const entryKey = sanctionScopeKey(userId, mod);
  const entry = guildBucket[entryKey];
  if (!entry) return { ok: false, line: `- <@${userId}> no tiene sancion activa.` };

  const now = Date.now();
  const currentEnd = new Date(entry.expiresAt).getTime();
  if (duration) {
    const nextEnd = Math.max(now, currentEnd - duration.ms);
    entry.expiresAt = new Date(nextEnd).toISOString();
    entry.reducedAt = new Date(now).toISOString();
    entry.reducedBy = interaction.user.id;
    guildBucket[entryKey] = entry;
    saveSanctions(store);
    return { ok: true, line: `- <@${userId}> reducido **${duration.label}**. Nuevo vencimiento <t:${Math.floor(nextEnd / 1000)}:R>.` };
  }

  delete guildBucket[entryKey];
  saveSanctions(store);
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member && entry.roleId && member.roles.cache.has(entry.roleId)) {
    await member.roles.remove(entry.roleId, `Sancion limpiada por ${interaction.user.tag}`).catch(() => null);
  }
  return { ok: true, line: `- <@${userId}> sancion limpiada.` };
};

const processExpiredSanctions = async (client) => {
  const store = readSanctions();
  const now = Date.now();
  let changed = false;

  for (const [guildId, guildBucket] of Object.entries(store)) {
    if (!require('./tournamentScope').allowedGuild(guildId)) continue;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild || !guildBucket || typeof guildBucket !== "object") continue;

    for (const [userId, entry] of Object.entries(guildBucket)) {
      const expires = new Date(entry.expiresAt).getTime();
      if (!Number.isFinite(expires) || expires > now) continue;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && entry.roleId && member.roles.cache.has(entry.roleId)) {
        await member.roles.remove(entry.roleId, "Sancion temporal expirada").catch(() => null);
      }
      delete guildBucket[userId];
      changed = true;
    }
  }

  if (changed) saveSanctions(store);
};

module.exports = {
  parseUserIds,
  parseDuration,
  parseModalities,
  splitSanctionArgs,
  canModerate,
  applySanction,
  clearSanction,
  processExpiredSanctions
};
