const crypto = require("crypto");
const supabaseState = require("./supabaseState");

const STAT_TYPES = {
  g: "goles",
  gol: "goles",
  goles: "goles",
  a: "asistencias",
  asis: "asistencias",
  asistencia: "asistencias",
  asistencias: "asistencias",
  v: "valla_invicta",
  vi: "valla_invicta",
  valla: "valla_invicta",
  "valla_invicta": "valla_invicta",
  gc: "goles_contra",
  gec: "goles_contra",
  "goles-contra": "goles_contra",
  "goles_contra": "goles_contra",
  "goles en contra": "goles_contra"
};

const TYPE_LABELS = {
  goles: "Goles",
  asistencias: "Asistencias",
  valla_invicta: "Valla invicta",
  goles_contra: "Goles en contra"
};

const TIER_WEIGHTS = {
  goles: 1,
  asistencias: 0.5,
  valla_invicta: 1 / 300
};

const normalizeKey = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

const emptyStore = () => ({ entries: [] });

const ensureStore = (input) => {
  const store = input && typeof input === "object" ? input : emptyStore();
  if (!Array.isArray(store.entries)) store.entries = [];
  return store;
};

const readStore = () => ensureStore(supabaseState.getDoc("stats"));

const saveStore = (store) => {
  const safeStore = ensureStore(store);
  supabaseState.setDoc("stats", safeStore);
  return safeStore;
};

const normalizeStatType = (raw) => {
  const key = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  return STAT_TYPES[key] || null;
};

const statLabel = (type) => TYPE_LABELS[type] || type || "Stats";

const parseTimeToSeconds = (raw) => {
  const value = String(raw || "").trim();
  const match = value.match(/^(-?)(\d+):([0-5]\d)$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * ((Number(match[2]) * 60) + Number(match[3]));
};

const formatSeconds = (seconds) => {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(Number(seconds) || 0);
  const minutes = Math.floor(abs / 60);
  const secs = String(abs % 60).padStart(2, "0");
  return `${sign}${minutes}:${secs}`;
};

const parseValue = (raw, statType) => {
  if (statType === "valla_invicta") {
    const seconds = parseTimeToSeconds(raw);
    if (seconds === null) return null;
    return seconds;
  }
  const value = Number(String(raw || "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

const formatValue = (value, statType) => {
  if (statType === "valla_invicta") return formatSeconds(Number(value) || 0);
  return String(Number(value) || 0);
};

const addEntries = (entries) => {
  const store = readStore();
  const now = new Date().toISOString();
  const saved = entries.map((entry) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    createdAt: now,
    ...entry
  }));
  store.entries.push(...saved);
  saveStore(store);
  return saved;
};

const replaceEntriesForMatch = ({
  partidoId = null,
  modality = null,
  fecha = null,
  clubNames = [],
  entries = []
} = {}) => {
  const store = readStore();
  const now = new Date().toISOString();
  const cleanPartidoId = String(partidoId || "").trim();
  const targetModality = String(modality || "").trim();
  const targetFecha = fecha === null || fecha === undefined || fecha === "" ? null : String(fecha);
  const targetClubKeys = new Set(clubNames.map(normalizeKey).filter(Boolean));

  store.entries = store.entries.filter((entry) => {
    const entryPartidoId = String(entry?.partidoId || entry?.matchId || "").trim();
    if (cleanPartidoId && entryPartidoId === cleanPartidoId) return false;

    if (!targetClubKeys.size || !targetModality || targetFecha === null) return true;
    if (String(entry?.modality || "").trim() !== targetModality) return true;
    if (String(entry?.fecha ?? "").trim() !== targetFecha) return true;
    if (!targetClubKeys.has(normalizeKey(entry?.clubName))) return true;
    return false;
  });

  const saved = entries.map((entry) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    createdAt: now,
    ...entry
  }));

  store.entries.push(...saved);
  saveStore(store);
  return saved;
};

const sumFor = ({ seasonId, modality, fecha, userId, statType }) => {
  return readStore().entries
    .filter((entry) =>
      (!seasonId || entry.seasonId === seasonId) &&
      (!modality || entry.modality === modality) &&
      (!fecha || String(entry.fecha) === String(fecha)) &&
      (!userId || String(entry.userId) === String(userId)) &&
      (!statType || entry.statType === statType)
    )
    .reduce((total, entry) => total + (Number(entry.value) || 0), 0);
};

const aggregate = ({ modality, statType, division = null, seasonId = null }) => {
  const rows = new Map();
  for (const entry of readStore().entries) {
    if (modality && entry.modality !== modality) continue;
    if (statType && entry.statType !== statType) continue;
    if (division && String(entry.division || "").toLowerCase() !== String(division).toLowerCase()) continue;
    if (seasonId && entry.seasonId !== seasonId) continue;

    const key = entry.playerId || entry.userId;
    const current = rows.get(key) || {
      playerId: entry.playerId || null,
      userId: entry.userId,
      displayName: entry.displayName || entry.userTag || entry.userName || entry.jugador_nombre,
      userTag: entry.userTag,
      clubName: entry.clubName,
      clubEmoji: entry.clubEmoji,
      division: entry.division,
      value: 0
    };
    current.value += Number(entry.value) || 0;
    current.playerId = entry.playerId || current.playerId;
    current.displayName = entry.displayName || current.displayName;
    current.userTag = entry.userTag || current.userTag;
    current.clubName = entry.clubName || current.clubName;
    current.clubEmoji = entry.clubEmoji || current.clubEmoji;
    current.division = entry.division || current.division;
    rows.set(key, current);
  }

  return Array.from(rows.values()).sort((a, b) => b.value - a.value);
};

const formatTierPoints = (value) => {
  const safe = Number(value) || 0;
  const rounded = Math.round(safe * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const aggregateTierPoints = ({ modality = null, seasonId = null, division = null } = {}) => {
  const rows = new Map();

  for (const entry of readStore().entries) {
    if (modality && entry.modality !== modality) continue;
    if (seasonId && entry.seasonId !== seasonId) continue;
    const entryDivision = String(entry.division || "sin-division").toLowerCase();
    if (division && entryDivision !== String(division).toLowerCase()) continue;

    const weight = TIER_WEIGHTS[entry.statType];
    if (!weight) continue;

    const resolvedDivision = entryDivision || "sin-division";
    const key = `${resolvedDivision}:${entry.playerId || entry.userId}`;

    const current = rows.get(key) || {
      playerId: entry.playerId || null,
      userId: entry.userId,
      displayName: entry.displayName || entry.userTag || entry.userName || entry.jugador_nombre,
      userTag: entry.userTag,
      clubName: entry.clubName,
      clubEmoji: entry.clubEmoji,
      division: resolvedDivision,
      modalities: new Set(),
      points: 0
    };

    current.points += (Number(entry.value) || 0) * weight;
    current.playerId = entry.playerId || current.playerId;
    current.displayName = entry.displayName || current.displayName;
    current.userTag = entry.userTag || current.userTag;
    current.clubName = entry.clubName || current.clubName;
    current.clubEmoji = entry.clubEmoji || current.clubEmoji;
    current.division = resolvedDivision || current.division;
    if (entry.modality) current.modalities.add(entry.modality);
    rows.set(key, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      modalities: Array.from(row.modalities || []).sort()
    }))
    .sort((a, b) => b.points - a.points || String(a.userTag || "").localeCompare(String(b.userTag || "")));
};

module.exports = {
  readStore,
  normalizeStatType,
  statLabel,
  parseValue,
  formatValue,
  addEntries,
  replaceEntriesForMatch,
  sumFor,
  aggregate,
  aggregateTierPoints,
  formatTierPoints
};
