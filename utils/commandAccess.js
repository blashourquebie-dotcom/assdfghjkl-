const { PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("./database");

const ELEVATED_FLAGS = new Set([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageRoles
].map((flag) => flag.toString()));

const getGuildBucket = (cfg, guildId) => {
  if (!guildId) return null;
  if (!cfg.commandAccess || typeof cfg.commandAccess !== "object") cfg.commandAccess = {};
  if (!cfg.commandAccess[guildId] || typeof cfg.commandAccess[guildId] !== "object") {
    cfg.commandAccess[guildId] = { users: [] };
  }
  if (!Array.isArray(cfg.commandAccess[guildId].users)) cfg.commandAccess[guildId].users = [];
  return cfg.commandAccess[guildId];
};

const isAdmin = (interaction) =>
  Boolean(interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator));

const hasDelegatedAccess = (interaction) => {
  if (isAdmin(interaction)) return true;
  const cfg = readConfig();
  const bucket = getGuildBucket(cfg, interaction.guild?.id);
  return Boolean(bucket?.users?.some((id) => String(id) === String(interaction.user?.id)));
};

const setUserAccess = (guildId, userId, enabled) => {
  const cfg = readConfig();
  const bucket = getGuildBucket(cfg, guildId);
  if (!bucket) return false;
  const id = String(userId);
  const users = new Set(bucket.users.map(String));
  if (enabled) users.add(id);
  else users.delete(id);
  bucket.users = Array.from(users);
  saveConfig(cfg);
  return true;
};

const listUserAccess = (guildId) => {
  const cfg = readConfig();
  const bucket = getGuildBucket(cfg, guildId);
  return bucket?.users || [];
};

const grantDelegatedPermissions = (interaction) => {
  if (!interaction?.member?.permissions?.has || !hasDelegatedAccess(interaction)) return false;
  const originalHas = interaction.member.permissions.has.bind(interaction.member.permissions);
  interaction.member.permissions.has = (permission, ...rest) => {
    if (Array.isArray(permission)) {
      return permission.every((flag) => ELEVATED_FLAGS.has(flag?.toString?.() || String(flag)) || originalHas(flag, ...rest));
    }
    if (ELEVATED_FLAGS.has(permission?.toString?.() || String(permission))) return true;
    return originalHas(permission, ...rest);
  };
  return true;
};

module.exports = {
  hasDelegatedAccess,
  setUserAccess,
  listUserAccess,
  grantDelegatedPermissions
};
