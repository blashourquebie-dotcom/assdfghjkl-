const MODALITY_REGEX = /^(x[1-9]\d*|rs-x[1-9]\d*)$/;

const normalizeModality = (m) => {
  if (!m) return null;

  let value = String(m).toLowerCase().trim();
  if (!value) return null;

  value = value.replace(/\s+/g, "");
  value = value.replace(/^(?:ft|fut|futsal)[-_]?/, "x");
  value = value.replace(/^x?fut[-_]?/, "x");
  value = value.replace(/^rs[-_]?fut[-_]?x?/, "rs-x");
  value = value.replace(/^rs[-_]?x?/, "rs-x");

  return MODALITY_REGEX.test(value) ? value : null;
};

const parseModalitiesInput = (raw) => {
  const parts = String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const modalities = [];
  const invalid = [];

  for (const part of parts) {
    const normalized = normalizeModality(part);
    if (!normalized) {
      invalid.push(part);
      continue;
    }
    if (!modalities.includes(normalized)) modalities.push(normalized);
  }

  return { modalities, invalid };
};

const getEnabledModalities = (cfg) => {
  return Array.from(
    new Set((cfg?.enabledModalities || []).map(normalizeModality).filter(Boolean))
  );
};

const isEnabledModality = (cfg, modality) => {
  const normalized = normalizeModality(modality);
  if (!normalized) return false;
  return getEnabledModalities(cfg).includes(normalized);
};

const ensureGuildBuckets = (cfg, guildId) => {
  if (!cfg.enabledRoles || typeof cfg.enabledRoles !== "object") cfg.enabledRoles = {};
  if (!cfg.enabledRoles[guildId] || typeof cfg.enabledRoles[guildId] !== "object") cfg.enabledRoles[guildId] = {};
  if (!cfg.generalRoles || typeof cfg.generalRoles !== "object") cfg.generalRoles = {};
  if (!cfg.generalRoles[guildId] || typeof cfg.generalRoles[guildId] !== "object") cfg.generalRoles[guildId] = {};
};

const ensureModalityBuckets = (cfg, guildId, modality) => {
  const mod = normalizeModality(modality);
  if (!mod) return null;
  ensureGuildBuckets(cfg, guildId);
  if (!Array.isArray(cfg.enabledRoles[guildId][mod])) cfg.enabledRoles[guildId][mod] = [];
  if (!cfg.generalRoles[guildId][mod] || typeof cfg.generalRoles[guildId][mod] !== "object") {
    cfg.generalRoles[guildId][mod] = {};
  }
  return mod;
};

const getClubRoles = (cfg, guildId, modality) => {
  const mod = normalizeModality(modality);
  if (!mod) return [];
  return Array.isArray(cfg.enabledRoles?.[guildId]?.[mod]) ? cfg.enabledRoles[guildId][mod] : [];
};

const addClubRole = (cfg, guildId, modality, entry) => {
  const mod = ensureModalityBuckets(cfg, guildId, modality);
  if (!mod || !entry?.roleId) return false;
  const roles = cfg.enabledRoles[guildId][mod];
  if (roles.some((r) => r.roleId === entry.roleId)) return false;
  roles.push(entry);
  return true;
};

const removeClubRole = (cfg, guildId, modality, roleId) => {
  const mod = normalizeModality(modality);
  if (!mod || !cfg.enabledRoles?.[guildId]?.[mod]) return false;
  const before = cfg.enabledRoles[guildId][mod].length;
  cfg.enabledRoles[guildId][mod] = cfg.enabledRoles[guildId][mod].filter((r) => r.roleId !== roleId);
  return cfg.enabledRoles[guildId][mod].length !== before;
};

const getGeneralRoles = (cfg, guildId, modality) => {
  const mod = normalizeModality(modality);
  if (!mod) return {};
  return cfg.generalRoles?.[guildId]?.[mod] || {};
};

const setGeneralRole = (cfg, guildId, modality, kind, { roleId, name }) => {
  const mod = ensureModalityBuckets(cfg, guildId, modality);
  if (!mod || !roleId || !["player", "captain", "subcaptain"].includes(kind)) return false;
  const bucket = cfg.generalRoles[guildId][mod];
  if (kind === "player") {
    bucket.playerRoleId = roleId;
    bucket.playerRoleName = name || bucket.playerRoleName || null;
  } else if (kind === "captain") {
    bucket.captainRoleId = roleId;
    bucket.captainRoleName = name || bucket.captainRoleName || null;
  } else {
    bucket.subcaptainRoleId = roleId;
    bucket.subcaptainRoleName = name || bucket.subcaptainRoleName || null;
  }
  return true;
};

const getGeneralRole = (cfg, guildId, modality, kind) => {
  const roles = getGeneralRoles(cfg, guildId, modality);
  if (kind === "player" && roles.playerRoleId) {
    return { roleId: roles.playerRoleId, name: roles.playerRoleName || null };
  }
  if (kind === "captain" && roles.captainRoleId) {
    return { roleId: roles.captainRoleId, name: roles.captainRoleName || null };
  }
  if (kind === "subcaptain" && roles.subcaptainRoleId) {
    return { roleId: roles.subcaptainRoleId, name: roles.subcaptainRoleName || null };
  }
  return null;
};

const getAllClubRoleIdsForGuild = (cfg, guildId) => {
  const out = new Set();
  const guildRoles = cfg.enabledRoles?.[guildId] || {};
  for (const entries of Object.values(guildRoles)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.roleId) out.add(entry.roleId);
    }
  }
  return Array.from(out);
};

module.exports = {
  normalizeModality,
  parseModalitiesInput,
  getEnabledModalities,
  isEnabledModality,
  getClubRoles,
  addClubRole,
  removeClubRole,
  getGeneralRoles,
  setGeneralRole,
  getGeneralRole,
  getAllClubRoleIdsForGuild
};
