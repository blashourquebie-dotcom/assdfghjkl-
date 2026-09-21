const { readConfig, saveConfig } = require("./database");
const roleRegistry = require("./roleRegistry");

const ensureBucket = (cfg, guildId) => {
  if (!cfg.antiDf || typeof cfg.antiDf !== "object") cfg.antiDf = {};
  if (!cfg.antiDf[guildId] || typeof cfg.antiDf[guildId] !== "object") {
    cfg.antiDf[guildId] = { modalityLimits: {}, tournamentLimits: {}, threads: {} };
  }
  if (!cfg.antiDf[guildId].modalityLimits || typeof cfg.antiDf[guildId].modalityLimits !== "object") {
    cfg.antiDf[guildId].modalityLimits = {};
  }
  if (!cfg.antiDf[guildId].tournamentLimits || typeof cfg.antiDf[guildId].tournamentLimits !== "object") {
    cfg.antiDf[guildId].tournamentLimits = {};
  }
  if (!cfg.antiDf[guildId].threads || typeof cfg.antiDf[guildId].threads !== "object") {
    cfg.antiDf[guildId].threads = {};
  }
  return cfg.antiDf[guildId];
};

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");

const isAntiDfTrigger = (content) => /(?:\banti\s*[-]?\s*df\b|\bantidf\b|\banti\b)/i.test(normalizeText(content));

const normalizeTournamentKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const getTournamentLimit = (guildId, modality, tournament) => {
  const cfg = readConfig();
  const mod = roleRegistry.normalizeModality(modality);
  const tournamentKey = normalizeTournamentKey(tournament);
  if (!mod || !tournamentKey) return null;
  const entry = cfg.antiDf?.[guildId]?.tournamentLimits?.[mod]?.[tournamentKey];
  return Number.isFinite(Number(entry)) ? Number(entry) : null;
};

const getEffectiveLimit = (guildId, modality, tournament = null) => {
  const tournamentLimit = tournament ? getTournamentLimit(guildId, modality, tournament) : null;
  if (Number.isFinite(Number(tournamentLimit))) return Number(tournamentLimit);
  return getModalityLimit(guildId, modality);
};

const linkThread = (guildId, channelId, modality, tournament = null) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg, guildId);
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  const tournamentName = String(tournament || "").trim();
  const tournamentKey = tournamentName ? normalizeTournamentKey(tournamentName) : null;

  bucket.threads[channelId] = {
    modality: mod,
    tournament: tournamentName || null,
    tournamentKey: tournamentKey || null,
    count: Number(bucket.threads[channelId]?.count) || 0,
    linkedAt: bucket.threads[channelId]?.linkedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  bucket.threads[channelId].limit = getEffectiveLimit(guildId, mod, tournamentKey || null);
  saveConfig(cfg);
  return bucket.threads[channelId];
};

const unlinkThread = (guildId, channelId) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg, guildId);
  if (!bucket.threads[channelId]) return false;
  delete bucket.threads[channelId];
  saveConfig(cfg);
  return true;
};

const setModalityLimit = (guildId, modality, limit) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg, guildId);
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  const value = Math.max(0, Number(limit) || 0);
  bucket.modalityLimits[mod] = value;
  for (const thread of Object.values(bucket.threads)) {
    if (thread?.modality === mod && !thread.tournament) thread.limit = value;
  }
  saveConfig(cfg);
  return value;
};

const setTournamentLimit = (guildId, modality, tournament, limit) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg, guildId);
  const mod = roleRegistry.normalizeModality(modality);
  const tournamentKey = normalizeTournamentKey(tournament);
  if (!mod || !tournamentKey) return null;

  const value = Math.max(0, Number(limit) || 0);
  bucket.tournamentLimits[mod] = bucket.tournamentLimits[mod] || {};
  bucket.tournamentLimits[mod][tournamentKey] = value;

  for (const thread of Object.values(bucket.threads)) {
    if (thread?.modality === mod && normalizeTournamentKey(thread?.tournamentKey || thread?.tournament) === tournamentKey) {
      thread.limit = value;
    }
  }

  saveConfig(cfg);
  return value;
};

const getThreadLink = (guildId, channelId) => {
  const cfg = readConfig();
  const bucket = cfg.antiDf?.[guildId];
  return bucket?.threads?.[channelId] || null;
};

const getModalityLimit = (guildId, modality) => {
  const cfg = readConfig();
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  const limit = cfg.antiDf?.[guildId]?.modalityLimits?.[mod];
  return Number.isFinite(Number(limit)) ? Number(limit) : null;
};

const incrementThreadCount = (guildId, channelId, amount = 1) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg, guildId);
  const thread = bucket.threads[channelId];
  if (!thread) return null;
  thread.count = Math.max(0, Number(thread.count) || 0) + Math.max(1, Number(amount) || 1);
  thread.updatedAt = new Date().toISOString();
  thread.limit = getEffectiveLimit(guildId, thread.modality, thread.tournamentKey || thread.tournament);
  saveConfig(cfg);
  return thread;
};

const decrementThreadCount = (guildId, channelId, amount = 1) => {
  const cfg = readConfig();
  const bucket = ensureBucket(cfg, guildId);
  const thread = bucket.threads[channelId];
  if (!thread) return null;
  thread.count = Math.max(0, (Number(thread.count) || 0) - Math.max(1, Number(amount) || 1));
  thread.updatedAt = new Date().toISOString();
  thread.limit = getEffectiveLimit(guildId, thread.modality, thread.tournamentKey || thread.tournament);
  saveConfig(cfg);
  return thread;
};

const userCanCount = (member, cfg, modality) => {
  if (!member) return false;
  if (member.permissions?.has("Administrator")) return true;
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return false;
  const roles = roleRegistry.getGeneralRoles(cfg, member.guild.id, mod);
  return Boolean(
    (roles.captainRoleId && member.roles.cache.has(roles.captainRoleId)) ||
    (roles.subcaptainRoleId && member.roles.cache.has(roles.subcaptainRoleId))
  );
};

const handleMessage = async (message) => {
  if (!message?.guild || message.author?.bot) return { counted: false };
  const cfg = readConfig();
  const link = getThreadLink(message.guild.id, message.channelId);
  if (!link) return { counted: false };

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member || !userCanCount(member, cfg, link.modality)) return { counted: false };
  if (!isAntiDfTrigger(message.content)) return { counted: false };

  const updated = incrementThreadCount(message.guild.id, message.channelId, 1);
  return {
    counted: true,
    thread: updated,
    limitReached: Boolean(updated?.limit && updated.count >= updated.limit)
  };
};

module.exports = {
  ensureBucket,
  isAntiDfTrigger,
  normalizeTournamentKey,
  linkThread,
  unlinkThread,
  setModalityLimit,
  setTournamentLimit,
  getThreadLink,
  getModalityLimit,
  getTournamentLimit,
  getEffectiveLimit,
  incrementThreadCount,
  decrementThreadCount,
  userCanCount,
  handleMessage
};
