const { PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("./database");
const clubs = require("./clubs");
const roleRegistry = require("./roleRegistry");

const normalizeClubRoleName = (clubName, modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!clubName || !mod) return null;
  return `${String(clubName).trim()} ${mod}`;
};

const ensureClubRoleForModality = async (guild, cfg, clubEntry, modality, options = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!guild || !cfg || !clubEntry || !mod) return null;

  if (!cfg.clubs || typeof cfg.clubs !== "object") cfg.clubs = {};
  if (!cfg.clubs[clubEntry.name] || typeof cfg.clubs[clubEntry.name] !== "object") {
    cfg.clubs[clubEntry.name] = { abbr: clubEntry.abbr || null, roles: {} };
  }
  if (!cfg.clubs[clubEntry.name].roles || typeof cfg.clubs[clubEntry.name].roles !== "object") {
    cfg.clubs[clubEntry.name].roles = {};
  }

  const storedRoleId = clubs.getRoleForClub(clubEntry, mod);
  if (storedRoleId) {
    const storedRole = guild.roles.cache.get(storedRoleId) || await guild.roles.fetch(storedRoleId).catch(() => null);
    if (storedRole) {
      cfg.clubs[clubEntry.name].roles[mod] = storedRole.id;
      roleRegistry.addClubRole(cfg, guild.id, mod, {
        roleId: storedRole.id,
        name: storedRole.name,
        createdAt: new Date().toISOString()
      });
      if (cfg.roleLimits?.[mod] !== undefined && cfg.roleLimits?.[storedRole.id] === undefined) {
        cfg.roleLimits[storedRole.id] = cfg.roleLimits[mod];
      }
      saveConfig(cfg);
      return { role: storedRole, created: false, relinked: true };
    }
  }

  const expectedName = normalizeClubRoleName(clubEntry.name, mod);
  const foundByName = guild.roles.cache.find((role) => String(role.name || "").trim().toLowerCase() === String(expectedName || "").trim().toLowerCase()) || null;
  if (foundByName) {
    cfg.clubs[clubEntry.name].roles[mod] = foundByName.id;
    roleRegistry.addClubRole(cfg, guild.id, mod, {
      roleId: foundByName.id,
      name: foundByName.name,
      createdAt: new Date().toISOString()
    });
    saveConfig(cfg);
    return { role: foundByName, created: false, relinked: true };
  }

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return null;

  const role = await guild.roles.create({
    name: expectedName,
    colors: { primaryColor: 0xFFFFFF },
    reason: options.reason || `Recuperacion de rol de club ${clubEntry.name} ${mod}`
  });

  cfg.clubs[clubEntry.name].roles[mod] = role.id;
  roleRegistry.addClubRole(cfg, guild.id, mod, {
    roleId: role.id,
    name: role.name,
    createdAt: new Date().toISOString()
  });
  if (cfg.roleLimits?.[mod] !== undefined) {
    cfg.roleLimits[role.id] = cfg.roleLimits[mod];
  }
  saveConfig(cfg);

  return { role, created: true, relinked: false };
};

const collectManagedRoleIds = (cfg, guildId) => {
  const ids = new Set();

  for (const club of Object.values(cfg.clubs || {})) {
    for (const roleId of Object.values(club?.roles || {})) {
      if (roleId) ids.add(roleId);
    }
  }

  for (const entries of Object.values(cfg.enabledRoles?.[guildId] || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.roleId) ids.add(entry.roleId);
    }
  }

  for (const entries of Object.values(cfg.generalRoles?.[guildId] || {})) {
    if (entries?.playerRoleId) ids.add(entries.playerRoleId);
    if (entries?.captainRoleId) ids.add(entries.captainRoleId);
    if (entries?.subcaptainRoleId) ids.add(entries.subcaptainRoleId);
  }

  for (const modBucket of Object.values(cfg.divisionRoles?.[guildId] || {})) {
    for (const division of Object.values(modBucket || {})) {
      if (division?.playerRoleId) ids.add(division.playerRoleId);
    }
  }

  return Array.from(ids);
};

module.exports = {
  ensureClubRoleForModality,
  collectManagedRoleIds,
  normalizeClubRoleName
};
