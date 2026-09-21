const { readConfig, saveConfig, readUsers, saveUsers } = require("./database");

const normalize = (s) => (s || "").toString().trim().toLowerCase();
const compact = (s) => normalize(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normalizeModality = (m) => {
  if (!m) return null;
  m = String(m).toLowerCase().trim().replace(/\s+/g, "");
  m = m.replace(/^(?:ft|fut|futsal)[-_]?/, "x");
  m = m.replace(/^x?fut[-_]?/, "x");
  m = m.replace(/^rs[-_]?ft[-_]?/, "rs-x");
  m = m.replace(/^rs[-_]?fut[-_]?x?/, "rs-x");
  m = m.replace(/^rs[-_]?x?/, "rs-x");
  return /^(x[1-9]\d*|rs-x[1-9]\d*)$/.test(m) ? m : null;
};

const findClub = (nameOrAbbr) => {
  const cfg = readConfig();
  const key = normalize(nameOrAbbr);
  const compactKey = compact(nameOrAbbr);
  if (!cfg.clubs) return null;
  
  for (const clubName of Object.keys(cfg.clubs)) {
    const c = cfg.clubs[clubName];
    if (
      normalize(clubName) === key ||
      normalize(c.abbr) === key ||
      normalize(c.shortName) === key ||
      compact(clubName) === compactKey ||
      compact(c.abbr) === compactKey ||
      compact(c.shortName) === compactKey
    ) {
      return { name: clubName, ...c };
    }
  }
  return null;
};

const isNameOrAbbrTaken = (name, abbr, excludeKey = null) => {
  const cfg = readConfig();
  if (!cfg.clubs) return null;
  
  const n = normalize(name);
  const a = normalize(abbr);
  const compactName = compact(name);
  const compactAbbr = compact(abbr);
  
  for (const clubName of Object.keys(cfg.clubs)) {
    if (excludeKey && normalize(clubName) === normalize(excludeKey)) continue;
    const c = cfg.clubs[clubName];
    if (
      normalize(clubName) === n ||
      normalize(c.abbr) === a ||
      compact(clubName) === compactName ||
      compact(c.abbr) === compactAbbr
    ) return clubName;
  }
  return null;
};

const registerClub = (name, abbr, metadata = {}) => {
  const cfg = readConfig();
  if (!cfg.clubs) cfg.clubs = {};
  
  const clubKey = normalize(name);
  const existing = cfg.clubs[name] || {};
  cfg.clubs[name] = {
    ...existing,
    abbr: abbr || existing.abbr || null,
    shortName: metadata.shortName || metadata.short_name || existing.shortName || name,
    logoUrl: metadata.logoUrl || metadata.logo_url || existing.logoUrl || null,
    pack: metadata.pack || existing.pack || null,
    modalidades: Array.isArray(metadata.modalities)
      ? metadata.modalities
      : Array.isArray(metadata.modalidades)
        ? metadata.modalidades
        : Array.isArray(existing.modalidades)
          ? existing.modalidades
          : [],
    emoji: metadata.emoji || existing.emoji || null,
    roles: existing.roles || {},
    createdAt: existing.createdAt || new Date().toISOString()
  };
  
  saveConfig(cfg);
  return { name, ...cfg.clubs[name] };
};

const linkRoleToClub = (clubName, modality, roleId) => {
  const cfg = readConfig();
  if (!cfg.clubs) cfg.clubs = {};
  if (!cfg.clubs[clubName]) return false;

  cfg.clubs[clubName].roles = cfg.clubs[clubName].roles || {};
  cfg.clubs[clubName].roles[modality] = roleId;

  saveConfig(cfg);
  return true;
};

const unregisterClub = (clubName) => {
  const cfg = readConfig();
  if (!cfg.clubs || !cfg.clubs[clubName]) return false;
  delete cfg.clubs[clubName];
  saveConfig(cfg);
  return true;
};

const unlinkRoleFromClub = (clubName, modality) => {
  const cfg = readConfig();
  if (!cfg.clubs?.[clubName]?.roles) return false;
  delete cfg.clubs[clubName].roles[modality];
  if (cfg.clubs[clubName].affiliations) delete cfg.clubs[clubName].affiliations[modality];
  if (cfg.clubs[clubName].captains) delete cfg.clubs[clubName].captains[modality];
  saveConfig(cfg);
  return true;
};

const getRoleForClub = (clubEntry, modality) => {
  if (!clubEntry) return null;
  const roles = clubEntry.roles || {};
  if (roles[modality]) return roles[modality];

  const normalizedTarget = normalizeModality(modality);
  if (!normalizedTarget) return null;

  for (const [storedModality, roleId] of Object.entries(roles)) {
    if (normalizeModality(storedModality) === normalizedTarget) {
      return roleId;
    }
  }

  return null;
};

const stripNickTags = (nick) => {
  if (!nick) return "";
  return nick.replace(/^(#\S+\s*)+/g, "").trim();
};

const getAllClubs = () => {
  const cfg = readConfig();
  return Object.entries(cfg.clubs || {}).map(([clubName, clubData]) => ({
    name: clubName,
    ...clubData
  }));
};

const searchClubs = (query = "") => {
  const q = normalize(query);
  const compactQuery = compact(query);

  return getAllClubs()
    .filter((club) => {
      if (!q) return true;
    return (
      normalize(club.name).includes(q) ||
      normalize(club.abbr).includes(q) ||
      normalize(club.shortName).includes(q) ||
      compact(club.name).includes(compactQuery) ||
      compact(club.abbr).includes(compactQuery) ||
      compact(club.shortName).includes(compactQuery)
    );
  })
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
};

const setClubEmoji = (clubName, emoji) => {
  const cfg = readConfig();
  if (!cfg.clubs?.[clubName]) return false;
  cfg.clubs[clubName].emoji = emoji;
  saveConfig(cfg);
  return true;
};

const editClubIdentity = (clubName, { name, abbr }) => {
  const cfg = readConfig();
  if (!cfg.clubs?.[clubName]) return null;

  const oldName = clubName;
  const oldClub = cfg.clubs[oldName];
  const newName = String(name || oldName).trim();
  const newAbbr = String(abbr || oldClub.abbr || "").trim();
  if (!newName || !newAbbr) return null;

  const updatedClub = {
    ...oldClub,
    abbr: newAbbr,
    updatedAt: new Date().toISOString()
  };

  if (newName !== oldName) {
    delete cfg.clubs[oldName];
    cfg.clubs[newName] = updatedClub;
  } else {
    cfg.clubs[oldName] = updatedClub;
  }

  const clubRoleIds = new Set(Object.values(updatedClub.roles || {}).filter(Boolean));
  for (const guildBucket of Object.values(cfg.enabledRoles || {})) {
    for (const entries of Object.values(guildBucket || {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry?.roleId && clubRoleIds.has(entry.roleId)) entry.name = newName;
      }
    }
  }

  saveConfig(cfg);

  const users = readUsers();
  for (const user of Object.values(users || {})) {
    if (!user?.clubAffiliations?.[oldName]) continue;

    const affiliation = {
      ...user.clubAffiliations[oldName],
      abbr: newAbbr
    };
    delete user.clubAffiliations[oldName];

    if (user.clubAffiliations[newName]) {
      user.clubAffiliations[newName] = {
        ...user.clubAffiliations[newName],
        abbr: newAbbr,
        modalities: {
          ...(user.clubAffiliations[newName].modalities || {}),
          ...(affiliation.modalities || {})
        }
      };
    } else {
      user.clubAffiliations[newName] = affiliation;
    }
  }
  saveUsers(users);

  return {
    oldName,
    oldAbbr: oldClub.abbr || null,
    name: newName,
    abbr: newAbbr,
    club: updatedClub
  };
};

module.exports = {
  findClub,
  registerClub,
  linkRoleToClub,
  getRoleForClub,
  isNameOrAbbrTaken,
  stripNickTags,
  unregisterClub,
  unlinkRoleFromClub,
  getAllClubs,
  searchClubs,
  setClubEmoji,
  editClubIdentity
};
