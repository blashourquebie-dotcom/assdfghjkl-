const crypto = require("crypto");
const { readConfig } = require("./database");
const supabaseState = require("./supabaseState");

const emptyStore = () => ({
  linksByGuild: {},
  pendingSessions: {},
  playerAliasesByGuild: {}
});

const normalizeValue = (value) => String(value || "").trim();

const readStore = () => {
  const store = supabaseState.getDoc("officials");
  if (!store || typeof store !== "object") return emptyStore();
  if (!store.linksByGuild || typeof store.linksByGuild !== "object") store.linksByGuild = {};
  if (!store.pendingSessions || typeof store.pendingSessions !== "object") store.pendingSessions = {};
  if (!store.playerAliasesByGuild || typeof store.playerAliasesByGuild !== "object") store.playerAliasesByGuild = {};
  return store;
};

const saveStore = (store) => {
  const safeStore = readStore();
  safeStore.linksByGuild = store?.linksByGuild && typeof store.linksByGuild === "object" ? store.linksByGuild : {};
  safeStore.pendingSessions = store?.pendingSessions && typeof store.pendingSessions === "object" ? store.pendingSessions : {};
  safeStore.playerAliasesByGuild = store?.playerAliasesByGuild && typeof store.playerAliasesByGuild === "object" ? store.playerAliasesByGuild : {};
  supabaseState.setDoc("officials", safeStore);
  return safeStore;
};

const ensureGuildBucket = (store, guildId) => {
  const id = String(guildId || "").trim();
  if (!id) return null;
  if (!store.linksByGuild[id] || typeof store.linksByGuild[id] !== "object") {
    store.linksByGuild[id] = {};
  }
  return store.linksByGuild[id];
};

const ensureAliasBucket = (store, guildId) => {
  const id = String(guildId || "").trim();
  if (!id) return null;
  if (!store.playerAliasesByGuild[id] || typeof store.playerAliasesByGuild[id] !== "object") {
    store.playerAliasesByGuild[id] = {};
  }
  return store.playerAliasesByGuild[id];
};

const normalizeAlias = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

const getLinksForUser = (guildId, userId) => {
  const store = readStore();
  if (!require("./tournamentScope").allowedGuild(guildId)) return [];
  const unique = new Map();
  for (const [id,bucket] of Object.entries(store.linksByGuild || {})) {
    if (!require("./tournamentScope").allowedGuild(id)) continue;
    for (const link of bucket[String(userId)]?.links || []) unique.set(normalizeValue(link.auth),link);
  }
  return [...unique.values()];
};

const setLinksForUser = (guildId, userId, links) => {
  const store = readStore();
  const bucket = ensureGuildBucket(store, guildId);
  if (!bucket) return null;
  bucket[String(userId)] = bucket[String(userId)] || { links: [], lastUpdatedAt: null };
  bucket[String(userId)].links = links;
  bucket[String(userId)].lastUpdatedAt = new Date().toISOString();
  saveStore(store);
  return bucket[String(userId)];
};

const addAuthLink = ({ guildId, userId, auth, conn = null, ip = null, addedBy = null, reason = null }) => {
  const cleanAuth = normalizeValue(auth);
  if (!cleanAuth) return { ok: false, error: "Auth invalida." };

  const store = readStore();
  if (!require("./tournamentScope").allowedGuild(guildId)) return {ok:false,error:"Servidor no autorizado."};
  for (const [id,users] of Object.entries(store.linksByGuild || {})) {
    if (!require("./tournamentScope").allowedGuild(id)) continue;
    for (const [uid,entry] of Object.entries(users)) {
      if (uid !== String(userId) && (entry.links || []).some(link => normalizeValue(link.auth) === cleanAuth)) {
        return {ok:false,error:"Ese auth ya pertenece a otro Discord en una de las ligas."};
      }
    }
  }
  const sharedLinks = getLinksForUser(guildId,userId);
  if (sharedLinks.some(link => normalizeValue(link.auth) === cleanAuth)) return {ok:false,error:"Ese auth ya está registrado y sirve en todas las ligas."};
  if (sharedLinks.length >= 3) return {ok:false,error:"Límite de 3 auths por Discord entre todas las ligas."};
  const bucket = ensureGuildBucket(store, guildId);
  if (!bucket) return { ok: false, error: "Guild invalida." };

  const userBucket = bucket[String(userId)] || { links: [], lastUpdatedAt: null };
  if ((userBucket.links || []).length >= 3) {
    return { ok: false, error: "Ese Discord ya llego al limite de 3 auths vinculadas." };
  }

  const duplicate = userBucket.links?.some((entry) => normalizeValue(entry.auth) === cleanAuth);
  if (duplicate) {
    return { ok: false, error: "Esa auth ya estaba vinculada a ese Discord." };
  }

  for (const [otherUserId, otherBucket] of Object.entries(bucket)) {
    if (String(otherUserId) === String(userId)) continue;
    if ((otherBucket.links || []).some((entry) => normalizeValue(entry.auth) === cleanAuth)) {
      return { ok: false, error: "Esa auth ya esta vinculada a otro Discord dentro de este servidor." };
    }
  }

  const link = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    auth: cleanAuth,
    conn: normalizeValue(conn) || null,
    ip: normalizeValue(ip) || null,
    reason: normalizeValue(reason) || null,
    addedBy: addedBy || null,
    createdAt: new Date().toISOString()
  };

  userBucket.links = [...(userBucket.links || []), link];
  userBucket.lastUpdatedAt = new Date().toISOString();
  bucket[String(userId)] = userBucket;
  saveStore(store);
  return { ok: true, link, total: userBucket.links.length };
};

const addPlayerAlias = ({ guildId, userId, playerName, addedBy = null, source = "report" }) => {
  const cleanName = normalizeValue(playerName);
  const aliasKey = normalizeAlias(cleanName);
  if (!guildId || !userId || !aliasKey) return { ok: false, error: "Alias invalido." };

  const store = readStore();
  const bucket = ensureAliasBucket(store, guildId);
  if (!bucket) return { ok: false, error: "Guild invalida." };

  bucket[String(userId)] = bucket[String(userId)] || { aliases: [], lastUpdatedAt: null };
  const userBucket = bucket[String(userId)];
  if (!Array.isArray(userBucket.aliases)) userBucket.aliases = [];

  const existing = userBucket.aliases.find((entry) => normalizeAlias(entry.name) === aliasKey);
  if (existing) {
    existing.lastSeenAt = new Date().toISOString();
    existing.source = source;
    existing.addedBy = addedBy || existing.addedBy || null;
  } else {
    userBucket.aliases.push({
      name: cleanName,
      source,
      addedBy: addedBy || null,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
  }
  userBucket.lastUpdatedAt = new Date().toISOString();
  saveStore(store);
  return { ok: true, total: userBucket.aliases.length };
};

const findLinkedDiscordByPlayerName = ({ guildId, playerName }) => {
  const store = readStore();
  const bucket = store.playerAliasesByGuild?.[String(guildId)] || {};
  const wanted = normalizeAlias(playerName);
  if (!wanted) return null;

  for (const [userId, userBucket] of Object.entries(bucket)) {
    for (const alias of userBucket.aliases || []) {
      if (normalizeAlias(alias.name) === wanted) {
        return { userId, alias, reason: "playerName" };
      }
    }
  }

  return null;
};

const removeAuthLink = ({ guildId, userId, auth }) => {
  const cleanAuth = normalizeValue(auth);
  if (!cleanAuth) return { ok: false, error: "Auth invalida." };
  if (!require("./tournamentScope").allowedGuild(guildId)) return {ok:false,error:"Servidor no autorizado."};

  const store = readStore();
  let removed = false;
  for (const [id,bucket] of Object.entries(store.linksByGuild || {})) {
    if (!require("./tournamentScope").allowedGuild(id)) continue;
    const entry = bucket[String(userId)];
    if (!entry) continue;
    const before = entry.links?.length || 0;
    entry.links = (entry.links || []).filter(link => normalizeValue(link.auth) !== cleanAuth);
    removed ||= entry.links.length !== before;
    if (!entry.links.length) delete bucket[String(userId)];
  }
  saveStore(store);
  return { ok: removed, total: getLinksForUser(guildId,userId).length };
};

const listGuildAuths = (guildId, userId = null) => {
  const store = readStore();
  const bucket = store.linksByGuild?.[String(guildId)] || {};
  if (userId) return bucket[String(userId)]?.links || [];
  return bucket;
};

const findLinkedDiscord = ({ guildId, auth = null, conn = null, ip = null }) => {
  const store = readStore();
  if (!require("./tournamentScope").allowedGuild(guildId)) return null;
  const bucket = store.linksByGuild?.[String(guildId)] || {};
  const cleanAuth = normalizeValue(auth);
  const cleanConn = normalizeValue(conn);
  const cleanIp = normalizeValue(ip);
  if (cleanAuth) {
    const matches = new Map();
    for (const [id,users] of Object.entries(store.linksByGuild || {})) {
      if (!require("./tournamentScope").allowedGuild(id)) continue;
      for (const [userId,entry] of Object.entries(users)) {
        for (const link of entry.links || []) if (normalizeValue(link.auth) === cleanAuth) matches.set(userId,{userId,link,reason:"auth"});
      }
    }
    // Do not fall back to IP/conn on conflicting ownership.
    if (matches.size > 1) return null;
    if (matches.size === 1) return [...matches.values()][0];
  }

  for (const [userId, userBucket] of Object.entries(bucket)) {
    for (const link of userBucket.links || []) {
      if (cleanAuth && normalizeValue(link.auth) === cleanAuth) return { userId, link, reason: "auth" };
      if (cleanConn && normalizeValue(link.conn) && normalizeValue(link.conn) === cleanConn) return { userId, link, reason: "conn" };
      if (cleanIp && normalizeValue(link.ip) && normalizeValue(link.ip) === cleanIp) return { userId, link, reason: "ip" };
    }
  }

  return null;
};

const createPendingSession = ({ guildId, channelId, messageId = null, validationId = null, playerName, auth, conn, ip, matchedUserId = null, matchedBy = null, source = "script", room = null }) => {
  const store = readStore();
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  store.pendingSessions[id] = {
    id,
    guildId: String(guildId),
    channelId: String(channelId),
    messageId: messageId ? String(messageId) : null,
    validationId: normalizeValue(validationId) || null,
    playerName: normalizeValue(playerName) || "Jugador",
    auth: normalizeValue(auth) || null,
    conn: normalizeValue(conn) || null,
    ip: normalizeValue(ip) || null,
    matchedUserId: matchedUserId ? String(matchedUserId) : null,
    matchedBy: matchedBy || null,
    source,
    room: room || null,
    status: "pending",
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    rejectedAt: null,
    decidedBy: null
  };
  saveStore(store);
  return store.pendingSessions[id];
};

const upsertPendingSession = ({ validationId, ...payload }) => {
  const store = readStore();
  const cleanValidationId = normalizeValue(validationId);
  if (!cleanValidationId) return null;

  const existing = Object.values(store.pendingSessions || {}).find((session) => normalizeValue(session.validationId) === cleanValidationId && String(session.guildId) === String(payload.guildId));
  if (existing) {
    if(['playerName','auth','conn','ip'].some(key=>normalizeValue(existing[key])!==normalizeValue(payload[key])))return null;
    if(existing.status!=='pending')return existing;
    Object.assign(existing, payload, { validationId: cleanValidationId });
    saveStore(store);
    return existing;
  }

  const session = createPendingSession({ ...payload, validationId: cleanValidationId });
  const refreshed = readStore();
  const stored = refreshed.pendingSessions?.[session.id];
  if (stored) stored.validationId = cleanValidationId;
  saveStore(refreshed);
  return stored || session;
};

const updatePendingSession = (sessionId, patch = {}) => {
  const store = readStore();
  const session = store.pendingSessions?.[sessionId];
  if (!session) return null;
  Object.assign(session, patch);
  saveStore(store);
  return session;
};

const getPendingSession = (sessionId) => readStore().pendingSessions?.[sessionId] || null;

const getPendingSessionByValidationId = (validationId, guildId = null) => {
  const cleanValidationId = normalizeValue(validationId);
  if (!cleanValidationId) return null;
  const matches = Object.values(readStore().pendingSessions || {}).filter((session) => normalizeValue(session.validationId) === cleanValidationId && (!guildId || String(session.guildId) === String(guildId)));
  if (!matches.length) return null;
  const priority = (session) => {
    if (session.status === "confirmed") return 3;
    if (session.status === "rejected") return 2;
    if (session.notifiedAt) return 1;
    return 0;
  };
  matches.sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pb - pa;
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });
  return matches[0] || null;
};

const listPendingSessions = (guildId = null) => {
  const sessions = Object.values(readStore().pendingSessions || {});
  if (!guildId) return sessions;
  return sessions.filter((session) => String(session.guildId) === String(guildId));
};

const removePendingSession = (sessionId) => {
  const store = readStore();
  if (!store.pendingSessions?.[sessionId]) return false;
  delete store.pendingSessions[sessionId];
  saveStore(store);
  return true;
};

const buildPublicSummary = () => {
  const cfg = readConfig();
  const store = readStore();
  const totalLinks = Object.values(store.linksByGuild || {}).reduce((acc, bucket) =>
    acc + Object.values(bucket || {}).reduce((inner, userBucket) => inner + (userBucket.links?.length || 0), 0), 0);

  return {
    guildCount: Object.keys(cfg.guilds || {}).length,
    clubCount: Object.keys(cfg.clubs || {}).length,
    forumCount: Object.keys(cfg.forumClubs || {}).length,
    linkedAuthCount: totalLinks,
    pendingSessionCount: Object.values(store.pendingSessions || {}).filter((session) => session.status === "pending").length
  };
};

module.exports = {
  readStore,
  saveStore,
  getLinksForUser,
  setLinksForUser,
  addAuthLink,
  addPlayerAlias,
  findLinkedDiscordByPlayerName,
  removeAuthLink,
  listGuildAuths,
  findLinkedDiscord,
  createPendingSession,
  updatePendingSession,
  getPendingSession,
  listPendingSessions,
  upsertPendingSession,
  removePendingSession,
  getPendingSessionByValidationId,
  buildPublicSummary
};
