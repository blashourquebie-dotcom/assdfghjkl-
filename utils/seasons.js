const crypto = require("crypto");
const roleRegistry = require("./roleRegistry");
const supabaseState = require("./supabaseState");

const emptyStore = () => ({ seasons: [], inactiveModalities: {} });

const ensureStore = (input) => {
  const store = input && typeof input === "object" ? input : emptyStore();
  if (!Array.isArray(store.seasons)) store.seasons = [];
  if (!store.inactiveModalities || typeof store.inactiveModalities !== "object") store.inactiveModalities = {};
  return store;
};

const readStore = () => ensureStore(supabaseState.getDoc("seasons"));

const saveStore = (store) => {
  const safeStore = ensureStore(store);
  supabaseState.setDoc("seasons", safeStore);
  return safeStore;
};

const normalizeName = (name) => String(name || "").trim();
const seasonKey = (name) => normalizeName(name).toLowerCase();

const parseModalities = (raw) => roleRegistry.parseModalitiesInput(raw);

const isInactiveModality = (modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return false;
  return Boolean(readStore().inactiveModalities?.[mod]);
};

const setInactiveModality = (modality, { by = null, reason = null } = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  const store = readStore();
  store.inactiveModalities[mod] = {
    modality: mod,
    reason: reason || null,
    by: by || null,
    disabledAt: new Date().toISOString()
  };
  saveStore(store);
  return store.inactiveModalities[mod];
};

const getActiveSeason = (modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  return readStore().seasons.find((season) => season.modality === mod && season.status === "active") || null;
};

const findSeason = ({ name, modality = null, includeFinished = true }) => {
  const key = seasonKey(name);
  const mod = roleRegistry.normalizeModality(modality);
  if (!key) return null;
  return readStore().seasons.find((season) => {
    if (seasonKey(season.name) !== key) return false;
    if (mod && season.modality !== mod) return false;
    if (!includeFinished && season.status === "finished") return false;
    return true;
  }) || null;
};

const startSeason = ({ name, modalities, by }) => {
  const cleanName = normalizeName(name);
  if (!cleanName) return { ok: false, error: "Nombre de temporada invalido." };

  const store = readStore();
  const created = [];
  const skipped = [];

  for (const rawModality of modalities || []) {
    const modality = roleRegistry.normalizeModality(rawModality);
    if (!modality) {
      skipped.push({ modality: rawModality, reason: "modalidad invalida" });
      continue;
    }
    if (store.inactiveModalities?.[modality]) {
      skipped.push({ modality, reason: "modalidad inactiva" });
      continue;
    }
    const active = store.seasons.find((season) => season.modality === modality && season.status === "active");
    if (active) {
      skipped.push({ modality, reason: `ya tiene temporada activa: ${active.name}` });
      continue;
    }
    const finishedSameName = store.seasons.find((season) =>
      season.modality === modality &&
      seasonKey(season.name) === seasonKey(cleanName) &&
      season.status === "finished"
    );
    if (finishedSameName) {
      skipped.push({ modality, reason: "esa temporada ya finalizo" });
      continue;
    }

    const season = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
      name: cleanName,
      displayName: `${cleanName} (${modality})`,
      modality,
      status: "active",
      startedAt: new Date().toISOString(),
      createdBy: by || null
    };
    store.seasons.push(season);
    created.push(season);
  }

  saveStore(store);
  return { ok: created.length > 0, created, skipped };
};

const finishSeason = ({ name, modality, champion, championDivision, runnerUp, runnerUpDivision, by }) => {
  const store = readStore();
  const mod = roleRegistry.normalizeModality(modality);
  const key = seasonKey(name);
  if (!key) return { ok: false, error: "Nombre de temporada invalido." };

  const matches = store.seasons.filter((season) =>
    seasonKey(season.name) === key &&
    season.status === "active" &&
    (!mod || season.modality === mod)
  );

  if (!matches.length) return { ok: false, error: "No encontre temporada activa con ese nombre." };

  for (const season of matches) {
    season.status = "finished";
    season.finishedAt = new Date().toISOString();
    season.finishedBy = by || null;
    season.championClub = normalizeName(champion) || null;
    season.championDivision = normalizeName(championDivision) || null;
    season.runnerUpClub = normalizeName(runnerUp) || null;
    season.runnerUpDivision = normalizeName(runnerUpDivision) || null;
  }

  saveStore(store);
  return { ok: true, finished: matches };
};

const listSeasons = () => readStore().seasons.slice();

module.exports = {
  readStore,
  saveStore,
  parseModalities,
  isInactiveModality,
  setInactiveModality,
  getActiveSeason,
  findSeason,
  startSeason,
  finishSeason,
  listSeasons
};
