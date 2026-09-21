const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const supabaseState = require("./supabaseState");

const DATA_DIR = path.join(__dirname, "..", "data");
const HISTORY_DIR = path.join(__dirname, "..", "clubs_historial");
const guildContext = new AsyncLocalStorage();

const withGuild = (guildId, fn) => guildContext.run(guildId ? String(guildId) : null, fn);
const getActiveGuildId = () => guildContext.getStore() || null;

const deepClone = (value) => JSON.parse(JSON.stringify(value));

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

const isGeneralRoleName = (name) => /^(jugador|cap)(futx|x|rsx)\d+$/i.test(String(name || "").trim());

const migrateConfigShape = (input) => {
  const cfg = input && typeof input === "object" ? input : {};
  let changed = false;

  if (!Array.isArray(cfg.enabledModalities)) {
    cfg.enabledModalities = [];
    changed = true;
  }
  const normalizedEnabledModalities = Array.from(new Set(cfg.enabledModalities.map(normalizeModality).filter(Boolean)));
  if (
    normalizedEnabledModalities.length !== cfg.enabledModalities.length ||
    normalizedEnabledModalities.some((mod, index) => mod !== cfg.enabledModalities[index])
  ) {
    cfg.enabledModalities = normalizedEnabledModalities;
    changed = true;
  }
  if (!cfg.enabledRoles || typeof cfg.enabledRoles !== "object") {
    cfg.enabledRoles = {};
    changed = true;
  }
  if (!cfg.generalRoles || typeof cfg.generalRoles !== "object") {
    cfg.generalRoles = {};
    changed = true;
  }
  if (!cfg.enabledDTRoles || typeof cfg.enabledDTRoles !== "object") {
    cfg.enabledDTRoles = {};
    changed = true;
  }
  if (!cfg.sanctionedRoles || typeof cfg.sanctionedRoles !== "object") {
    cfg.sanctionedRoles = {};
    changed = true;
  }
  if (!cfg.roleLimits || typeof cfg.roleLimits !== "object") {
    cfg.roleLimits = {};
    changed = true;
  }
  if (!cfg.subcaptainLimits || typeof cfg.subcaptainLimits !== "object") {
    cfg.subcaptainLimits = {};
    changed = true;
  }
  if (!cfg.automation || typeof cfg.automation !== "object") {
    cfg.automation = {
      autoNicknames: true,
      clubRolesBelowPlayer: true,
      antiSpam: { enabled: false, channelId: null }
    };
    changed = true;
  } else {
    if (typeof cfg.automation.autoNicknames !== "boolean") {
      cfg.automation.autoNicknames = true;
      changed = true;
    }
    if (typeof cfg.automation.clubRolesBelowPlayer !== "boolean") {
      cfg.automation.clubRolesBelowPlayer = true;
      changed = true;
    }
    if (!cfg.automation.antiSpam || typeof cfg.automation.antiSpam !== "object") {
      cfg.automation.antiSpam = { enabled: false, channelId: null };
      changed = true;
    } else {
      if (typeof cfg.automation.antiSpam.enabled !== "boolean") {
        cfg.automation.antiSpam.enabled = false;
        changed = true;
      }
      if (cfg.automation.antiSpam.channelId === undefined) {
        cfg.automation.antiSpam.channelId = null;
        changed = true;
      }
    }
  }
  if (!cfg.clubs || typeof cfg.clubs !== "object") {
    cfg.clubs = {};
    changed = true;
  }

  for (const [guildId, rawBucket] of Object.entries(cfg.enabledRoles)) {
    if (!rawBucket || typeof rawBucket !== "object" || Array.isArray(rawBucket)) continue;
    if (!cfg.generalRoles[guildId] || typeof cfg.generalRoles[guildId] !== "object") {
      cfg.generalRoles[guildId] = {};
      changed = true;
    }

    const normalizedBucket = {};
    for (const [rawModality, entries] of Object.entries(rawBucket)) {
      const modality = normalizeModality(rawModality);
      if (!modality) {
        changed = true;
        continue;
      }
      if (!Array.isArray(entries)) {
        normalizedBucket[modality] = normalizedBucket[modality] || [];
        changed = true;
        continue;
      }

      normalizedBucket[modality] = normalizedBucket[modality] || [];
      const filtered = [];
      for (const entry of entries) {
        if (!entry?.roleId) continue;
        const roleName = String(entry.name || "").trim();
        if (!isGeneralRoleName(roleName)) {
          filtered.push(entry);
          continue;
        }

        if (!cfg.generalRoles[guildId][modality] || typeof cfg.generalRoles[guildId][modality] !== "object") {
          cfg.generalRoles[guildId][modality] = {};
        }
        if (/^jugador/i.test(roleName)) {
          cfg.generalRoles[guildId][modality].playerRoleId = entry.roleId;
          cfg.generalRoles[guildId][modality].playerRoleName = roleName;
        } else if (/^cap/i.test(roleName)) {
          cfg.generalRoles[guildId][modality].captainRoleId = entry.roleId;
          cfg.generalRoles[guildId][modality].captainRoleName = roleName;
        }
        changed = true;
      }

      normalizedBucket[modality].push(...filtered);
      if (rawModality !== modality || filtered.length !== entries.length) changed = true;
    }
    cfg.enabledRoles[guildId] = normalizedBucket;
  }

  for (const [guildId, rawBucket] of Object.entries(cfg.generalRoles)) {
    if (!rawBucket || typeof rawBucket !== "object" || Array.isArray(rawBucket)) {
      cfg.generalRoles[guildId] = {};
      changed = true;
      continue;
    }

    const normalizedBucket = {};
    for (const [rawModality, entry] of Object.entries(rawBucket)) {
      const modality = normalizeModality(rawModality);
      if (!modality) {
        changed = true;
        continue;
      }
      normalizedBucket[modality] = entry && typeof entry === "object" ? entry : {};
      if (rawModality !== modality) changed = true;
    }
    cfg.generalRoles[guildId] = normalizedBucket;
  }

  for (const clubEntry of Object.values(cfg.clubs)) {
    if (!clubEntry || typeof clubEntry !== "object") continue;
    const normalizeModalityMap = (input) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) return {};
      const output = {};
      for (const [rawModality, value] of Object.entries(input)) {
        const modality = normalizeModality(rawModality);
        if (!modality) {
          changed = true;
          continue;
        }
        if (!(modality in output)) output[modality] = value;
        if (rawModality !== modality) changed = true;
      }
      return output;
    };

    clubEntry.roles = normalizeModalityMap(clubEntry.roles);
    clubEntry.affiliations = normalizeModalityMap(clubEntry.affiliations);
    clubEntry.captains = normalizeModalityMap(clubEntry.captains);
    if (!clubEntry.subcaptains || typeof clubEntry.subcaptains !== "object" || Array.isArray(clubEntry.subcaptains)) {
      clubEntry.subcaptains = {};
    } else {
      const general = clubEntry.subcaptains.general;
      clubEntry.subcaptains = normalizeModalityMap(clubEntry.subcaptains);
      if (general) clubEntry.subcaptains.general = general;
    }
  }

  const normalizedRoleLimits = {};
  for (const [key, value] of Object.entries(cfg.roleLimits)) {
    if (/^\d+$/.test(key)) {
      normalizedRoleLimits[key] = value;
      continue;
    }
    const modality = normalizeModality(key);
    if (!modality) {
      changed = true;
      continue;
    }
    normalizedRoleLimits[modality] = value;
    if (modality !== key) changed = true;
  }
  cfg.roleLimits = normalizedRoleLimits;

  return { cfg, changed };
};

const getGuildConfigBucket = (cfg, guildId, create = false) => {
  if (!guildId) return null;
  if (!cfg.guilds || typeof cfg.guilds !== "object" || Array.isArray(cfg.guilds)) {
    if (!create) return null;
    cfg.guilds = {};
  }
  if (!cfg.guilds[guildId] || typeof cfg.guilds[guildId] !== "object" || Array.isArray(cfg.guilds[guildId])) {
    if (!create) return null;
    cfg.guilds[guildId] = {};
  }
  return cfg.guilds[guildId];
};

const GUILD_FIELDS = ["clubs", "forumClubs", "roleLimits", "pendingTransfers", "automation", "enabledModalities", "subcaptainLimits", "archivedClubs", "reportSources", "reportApprovalsChannelId", "validationChannelId", "antiDuHistory", "antiDuOrigins", "antiDuSecret", "reportApprovalQueue", "markets", "clubDivisions", "divisionRoles", "subcaptainLimit", "antiDf"];
const legacyOwner = (cfg) => {
  if (cfg.legacyGuildId || process.env.LEGACY_GUILD_ID || process.env.GUILD_ID) return String(cfg.legacyGuildId || process.env.LEGACY_GUILD_ID || process.env.GUILD_ID);
  const ids = [...new Set([...Object.keys(cfg.enabledRoles || {}), ...Object.keys(cfg.generalRoles || {}), ...Object.keys(cfg.guilds || {})])];
  return ids.length === 1 ? ids[0] : null;
};
const localDefaults = () => ({ clubs: {}, forumClubs: {}, roleLimits: {}, pendingTransfers: {}, automation: { autoNicknames: true, clubRolesBelowPlayer: true, antiSpam: { enabled: false, channelId: null } }, enabledModalities: [], subcaptainLimits: {}, archivedClubs: {}, reportSources: {}, reportApprovalsChannelId: null, validationChannelId: null, antiDuHistory: [], reportApprovalQueue: {} });

const toGuildConfigView = (cfg, guildId) => {
  if (!guildId) return cfg;
  const bucket = getGuildConfigBucket(cfg, guildId, true);
  if (!bucket.__initialized && String(legacyOwner(cfg)) === String(guildId)) {
    if (!bucket.clubs && cfg.clubs && Object.keys(cfg.clubs).length) bucket.clubs = deepClone(cfg.clubs);
    if (!bucket.forumClubs && cfg.forumClubs && Object.keys(cfg.forumClubs).length) {
      bucket.forumClubs = Object.fromEntries(
        Object.entries(cfg.forumClubs).filter(([, link]) => !link?.guildId || String(link.guildId) === String(guildId))
      );
    }
    if (!bucket.roleLimits && cfg.roleLimits && Object.keys(cfg.roleLimits).length) bucket.roleLimits = deepClone(cfg.roleLimits);
    if (!bucket.pendingTransfers && cfg.pendingTransfers && Object.keys(cfg.pendingTransfers).length) {
      bucket.pendingTransfers = Object.fromEntries(
        Object.entries(cfg.pendingTransfers).filter(([, transfer]) => !transfer?.guildId || String(transfer.guildId) === String(guildId))
      );
    }
    bucket.__initialized = true;
  }

  const defaults = localDefaults();
  const view = { ...cfg };
  for (const key of GUILD_FIELDS) view[key] = bucket[key] ?? (String(legacyOwner(cfg)) === String(guildId) ? cfg[key] : undefined) ?? defaults[key];
  return view;
};

const mergeGuildConfigView = (baseCfg, guildId, view) => {
  if (!guildId) return view;
  const bucket = getGuildConfigBucket(baseCfg, guildId, true);
  for (const key of GUILD_FIELDS) bucket[key] = view[key] ?? localDefaults()[key];
  bucket.clubs = view.clubs || {};
  bucket.forumClubs = view.forumClubs || {};
  bucket.roleLimits = view.roleLimits || {};
  if (Object.prototype.hasOwnProperty.call(view || {}, "pendingTransfers")) {
    bucket.pendingTransfers = view.pendingTransfers || {};
  } else if (!bucket.pendingTransfers || typeof bucket.pendingTransfers !== "object") {
    bucket.pendingTransfers = {};
  }
  bucket.__initialized = true;

  for (const key of Object.keys(view || {})) {
    if ([...GUILD_FIELDS, "guilds"].includes(key)) continue;
    baseCfg[key] = view[key];
  }
  return baseCfg;
};

const ensureUserShape = (user, userId = null) => {
  const safeUser = user && typeof user === "object" ? { ...user } : {};
  if (!safeUser.id && userId) safeUser.id = userId;
  if (!safeUser.joinDate) safeUser.joinDate = new Date().toISOString();
  if (!safeUser.clubRoles || typeof safeUser.clubRoles !== "object") safeUser.clubRoles = {};
  if (!safeUser.clubAffiliations || typeof safeUser.clubAffiliations !== "object") safeUser.clubAffiliations = {};
  if (!Array.isArray(safeUser.sanctions)) safeUser.sanctions = [];
  if (!Array.isArray(safeUser.history)) safeUser.history = [];
  return safeUser;
};

const purgeUserModalityAffiliations = (user, modality, { keepClub = null, keepRoleId = null } = {}) => {
  const mod = normalizeModality(modality);
  if (!user || !mod) return false;

  if (!user.clubRoles || typeof user.clubRoles !== "object") user.clubRoles = {};
  if (!user.clubAffiliations || typeof user.clubAffiliations !== "object") user.clubAffiliations = {};

  let changed = false;

  for (const [clubName, entry] of Object.entries(user.clubAffiliations)) {
    if (keepClub && String(clubName) === String(keepClub)) continue;
    if (!entry?.modalities?.[mod]) continue;
    delete entry.modalities[mod];
    changed = true;
    if (!Object.keys(entry.modalities || {}).length) delete user.clubAffiliations[clubName];
  }

  if (keepRoleId) {
    if (user.clubRoles[mod] !== keepRoleId) {
      user.clubRoles[mod] = keepRoleId;
      changed = true;
    }
  } else if (user.clubRoles[mod] !== undefined) {
    delete user.clubRoles[mod];
    changed = true;
  }

  return changed;
};

const isGuildUsersShape = (data) => data && typeof data === "object" && data.guilds && typeof data.guilds === "object";

const initDB = async () => {
  await supabaseState.bootstrap();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
};

const readConfig = () => {
  const guildId = getActiveGuildId();
  const cfg = migrateConfigShape(supabaseState.getDoc("config")).cfg;
  return deepClone(toGuildConfigView(cfg, guildId));
};

const saveConfig = (data) => {
  try {
    const guildId = getActiveGuildId();
    const current = migrateConfigShape(supabaseState.getDoc("config")).cfg;
    const mergedInput = guildId ? mergeGuildConfigView(current, guildId, deepClone(data)) : deepClone(data);
    const { cfg } = migrateConfigShape(mergedInput);
    supabaseState.setDoc("config", cfg);
  } catch (err) {
    console.error("saveConfig failed", err);
  }
};

const readUsers = (guildId = getActiveGuildId()) => {
  const data = supabaseState.getDoc("users");
  if (!guildId) return isGuildUsersShape(data) ? (data.global || {}) : data;
  if (!isGuildUsersShape(data)) return String(legacyOwner(supabaseState.getDoc("config"))) === String(guildId) ? data : {};
  return data.guilds?.[String(guildId)] || {};
};

const saveUsers = (data) => {
  const guildId = getActiveGuildId();
  if (!guildId) {
    supabaseState.setDoc("users", data);
    return;
  }

  const current = supabaseState.getDoc("users");
  let next = current;
  if (!isGuildUsersShape(current)) {
    const owner = legacyOwner(supabaseState.getDoc("config"));
    next = { guilds: owner ? { [owner]: current } : {}, global: {}, legacy: current };
  }
  next.guilds[String(guildId)] = data || {};
  supabaseState.setDoc("users", next);
};

const readSanctions = () => supabaseState.getDoc("sanctions");
const readMatches = () => supabaseState.getDoc("matches");
const saveSanctions = (data) => supabaseState.setDoc("sanctions", data);
const saveMatches = (data) => supabaseState.setDoc("matches", data);

const getUser = (userId, guildId = getActiveGuildId()) => {
  const users = readUsers(guildId);
  return ensureUserShape(users[userId] || {
    id: userId,
    joinDate: new Date().toISOString(),
    clubRoles: {},
    clubAffiliations: {},
    sanctions: [],
    history: []
  }, userId);
};

const saveUser = (userId, data) => {
  const users = readUsers();
  users[userId] = ensureUserShape(data, userId);
  saveUsers(users);
};

const upsertUserClubAffiliation = (userId, { club, abbr, modality, roleId, by }) => {
  if (!club || !modality || !roleId) return null;
  const user = getUser(userId);
  const now = new Date().toISOString();
  const existing = user.clubAffiliations?.[club]?.modalities?.[modality] || null;

  purgeUserModalityAffiliations(user, modality, { keepClub: club, keepRoleId: roleId });
  user.clubAffiliations[club] = user.clubAffiliations[club] || {
    abbr: abbr || null,
    modalities: {}
  };
  if (abbr) user.clubAffiliations[club].abbr = abbr;
  user.clubAffiliations[club].modalities[modality] = {
    roleId,
    signedAt: existing?.signedAt || existing?.updatedAt || now,
    updatedAt: now,
    by: by || null
  };
  saveUser(userId, user);
  return user;
};

const removeUserClubAffiliation = (userId, { club, modality, roleId }) => {
  const user = getUser(userId);
  const mod = normalizeModality(modality);

  if (mod) {
    purgeUserModalityAffiliations(user, mod, { keepClub: club || null, keepRoleId: null });
  }

  if (club && user.clubAffiliations[club]) {
    if (mod) {
      delete user.clubAffiliations[club].modalities?.[mod];
      if (!Object.keys(user.clubAffiliations[club].modalities || {}).length) {
        delete user.clubAffiliations[club];
      }
    } else {
      delete user.clubAffiliations[club];
    }
  } else if (mod) {
    for (const [clubName, entry] of Object.entries(user.clubAffiliations || {})) {
      const matchesRole = !roleId || entry?.modalities?.[mod]?.roleId === roleId;
      if (entry?.modalities?.[mod] && matchesRole) {
        delete entry.modalities[mod];
        if (!Object.keys(entry.modalities || {}).length) delete user.clubAffiliations[clubName];
      }
    }
  }

  saveUser(userId, user);
  return user;
};

const getUserClubAffiliationForModality = (userId, modality) => {
  const user = getUser(userId);
  const mod = normalizeModality(modality);
  if (!mod) return null;

  for (const [club, entry] of Object.entries(user.clubAffiliations || {})) {
    const affiliation = entry?.modalities?.[mod];
    if (!affiliation?.roleId) continue;
    return {
      club,
      abbr: entry.abbr || null,
      modality: mod,
      roleId: affiliation.roleId,
      signedAt: affiliation.signedAt || null,
      updatedAt: affiliation.updatedAt || null,
      by: affiliation.by || null
    };
  }

  return null;
};

const addHistory = (userId, action, details) => {
  const user = getUser(userId);
  user.history.push({
    action,
    details,
    timestamp: new Date().toISOString()
  });
  saveUser(userId, user);

  const cfg = readConfig();
  if (cfg.historialEnabled) {
    const club = details.club || details.oldClub || "unknown";
    const mod = details.modality || details.modalidad || "unknown";
    const dir = path.join(HISTORY_DIR, club.replace(/[^a-zA-Z0-9]/g, "_"));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${mod}.txt`);
    const line = `${action} - @${userId} - ${new Date().toLocaleString()} - ${JSON.stringify(details)}\n`;
    fs.appendFileSync(file, line);
  }
};

module.exports = {
  withGuild,
  getActiveGuildId,
  initDB,
  readConfig,
  readUsers,
  readSanctions,
  readMatches,
  saveConfig,
  saveUsers,
  saveSanctions,
  saveMatches,
  getUser,
  saveUser,
  addHistory,
  upsertUserClubAffiliation,
  removeUserClubAffiliation,
  getUserClubAffiliationForModality,
  purgeUserModalityAffiliations
};
