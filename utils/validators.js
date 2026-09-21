const { readConfig } = require("./database");
const roleRegistry = require("./roleRegistry");

const validators = {
  isModalityEnabled: (modality) => {
    const config = readConfig();
    return config.enabledModalities?.includes(modality) || false;
  },

  isRoleEnabledFor: (modality, roleId) => {
    const config = readConfig();
    const roles = Object.keys(config.enabledRoles || {}).flatMap((gid) =>
      roleRegistry.getClubRoles(config, gid, modality)
    );
    return roles.some((r) => r.roleId === roleId);
  },

  getEnabledRole: (modality, roleId) => {
    const config = readConfig();
    const roles = Object.keys(config.enabledRoles || {}).flatMap((gid) =>
      roleRegistry.getClubRoles(config, gid, modality)
    );
    return roles.find((r) => r.roleId === roleId);
  },

  getEnabledRoles: (modality) => {
    const config = readConfig();
    return Object.keys(config.enabledRoles || {}).flatMap((gid) =>
      roleRegistry.getClubRoles(config, gid, modality)
    );
  },

  isDTRoleEnabledFor: (modality) => {
    const config = readConfig();
    return config.enabledDTRoles?.[modality] !== undefined;
  },

  getDTRole: (modality) => {
    const config = readConfig();
    return config.enabledDTRoles?.[modality];
  },

  isSanctionedRoleEnabledFor: (modality) => {
    const config = readConfig();
    return config.sanctionedRoles?.[modality] !== undefined;
  },

  getSanctionedRole: (modality) => {
    const config = readConfig();
    return config.sanctionedRoles?.[modality];
  },

  getSubcaptainLimit: (modality = null) => {
    const config = readConfig();
    const mod = roleRegistry.normalizeModality(modality);
    if (mod && config.subcaptainLimits?.[mod] !== undefined) return config.subcaptainLimits[mod];
    if (config.subcaptainLimit !== undefined) return config.subcaptainLimit;
    return null;
  },

  getRoleLimit: (roleId, modality = null) => {
    const config = readConfig();
    if (config.roleLimits?.[roleId]) return config.roleLimits[roleId];
    if (modality && config.roleLimits?.[modality]) return config.roleLimits[modality];
    return null;
  },

  canAddRoleToUser: async (guild, roleId, newMemberCount, modality = null) => {
    const limit = validators.getRoleLimit(roleId, modality);
    if (!limit) return true;

    try {
      await guild.members.fetch().catch(() => null);
      const role = await guild.roles.fetch(roleId);
      const amount = Number.isFinite(Number(newMemberCount)) ? Number(newMemberCount) : 1;
      return role.members.size + Math.max(0, amount - 1) < limit;
    } catch {
      return false;
    }
  },

  isAdmin: (member) => {
    return member.permissions.has("ADMINISTRATOR");
  },

  isDT: (member, modality) => {
    const config = readConfig();
    const dtRole = config.enabledDTRoles?.[modality];
    if (!dtRole) return false;
    return member.roles.cache.has(dtRole.roleId);
  },

  isValidModality: (modality) => {
    if (!modality) return false;
    const m = String(modality).toLowerCase().trim();
    return /^(x[1-9]\d*|rs-x[1-9]\d*)$/.test(m);
  }
};

module.exports = validators;
