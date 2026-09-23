const fs = require("fs");
const path = require("path");
const supabaseClient = require("./supabaseClient");

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGACY_FILES = {
  config: path.join(DATA_DIR, "config.json"),
  users: path.join(DATA_DIR, "users.json"),
  sanctions: path.join(DATA_DIR, "sanctions.json"),
  matches: path.join(DATA_DIR, "matches.json"),
  officials: path.join(DATA_DIR, "officials.json"),
  seasons: path.join(DATA_DIR, "seasons.json"),
  stats: path.join(DATA_DIR, "stats.json")
};

const STATE_DOCS_TABLE = "bot_state_documents";
const DEFAULT_DOCS = {
  config: {
    enabledModalities: [],
    enabledRoles: {},
    generalRoles: {},
    enabledDTRoles: {},
    sanctionedRoles: {},
    roleLimits: {},
    subcaptainLimits: {},
    pendingTransfers: {},
    clubs: {},
    automation: {
      autoNicknames: true,
      clubRolesBelowPlayer: true,
      antiSpam: { enabled: false, channelId: null }
    }
  },
  users: {},
  sanctions: {},
  matches: [],
  officials: {
    linksByGuild: {},
    pendingSessions: {}
  },
  seasons: {
    seasons: [],
    inactiveModalities: {}
  },
  stats: {
    entries: []
  }
};

const cache = {
  ready: false,
  bootstrapping: null,
  docs: { ...DEFAULT_DOCS }
};
const pendingWrites = new Map();

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const readLegacyDoc = (name) => {
  try {
    const file = LEGACY_FILES[name];
    if (!file || !fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeDoc = (name, data) => {
  if (name === "config") {
    const value = data && typeof data === "object" ? deepClone(data) : {};
    if (!Array.isArray(value.enabledModalities)) value.enabledModalities = [];
    if (!value.enabledRoles || typeof value.enabledRoles !== "object") value.enabledRoles = {};
    if (!value.generalRoles || typeof value.generalRoles !== "object") value.generalRoles = {};
    if (!value.enabledDTRoles || typeof value.enabledDTRoles !== "object") value.enabledDTRoles = {};
    if (!value.sanctionedRoles || typeof value.sanctionedRoles !== "object") value.sanctionedRoles = {};
    if (!value.roleLimits || typeof value.roleLimits !== "object") value.roleLimits = {};
    if (!value.subcaptainLimits || typeof value.subcaptainLimits !== "object") value.subcaptainLimits = {};
    if (!value.pendingTransfers || typeof value.pendingTransfers !== "object") value.pendingTransfers = {};
    if (!value.clubs || typeof value.clubs !== "object") value.clubs = {};
    if (!value.automation || typeof value.automation !== "object") {
      value.automation = DEFAULT_DOCS.config.automation;
    } else {
      if (typeof value.automation.autoNicknames !== "boolean") value.automation.autoNicknames = true;
      if (typeof value.automation.clubRolesBelowPlayer !== "boolean") value.automation.clubRolesBelowPlayer = true;
      if (!value.automation.antiSpam || typeof value.automation.antiSpam !== "object") {
        value.automation.antiSpam = { enabled: false, channelId: null };
      } else {
        if (typeof value.automation.antiSpam.enabled !== "boolean") value.automation.antiSpam.enabled = false;
        if (value.automation.antiSpam.channelId === undefined) value.automation.antiSpam.channelId = null;
      }
    }
    if (!value.meta || typeof value.meta !== "object") value.meta = {};
    return value;
  }

  if (name === "users") {
    const value = data && typeof data === "object" ? deepClone(data) : {};
    if (value.guilds && typeof value.guilds === "object") return value;
    return value;
  }

  if (name === "sanctions") return data && typeof data === "object" ? deepClone(data) : {};
  if (name === "matches") return Array.isArray(data) ? deepClone(data) : [];

  if (name === "officials") {
    const value = data && typeof data === "object" ? deepClone(data) : {};
    if (!value.linksByGuild || typeof value.linksByGuild !== "object") value.linksByGuild = {};
    if (!value.pendingSessions || typeof value.pendingSessions !== "object") value.pendingSessions = {};
    return value;
  }

  if (name === "seasons") {
    const value = data && typeof data === "object" ? deepClone(data) : {};
    if (!Array.isArray(value.seasons)) value.seasons = [];
    if (!value.inactiveModalities || typeof value.inactiveModalities !== "object") value.inactiveModalities = {};
    return value;
  }

  if (name === "stats") {
    const value = data && typeof data === "object" ? deepClone(data) : {};
    if (!Array.isArray(value.entries)) value.entries = [];
    return value;
  }

  return deepClone(data);
};

const persistDoc = async (name) => {
  if (!supabaseClient.isEnabled) return false;
  const data = cache.docs[name];
  if (data === undefined) return false;
  const result = await supabaseClient.upsertRows(STATE_DOCS_TABLE, [{
    name,
    data
  }], "name");
  return Boolean(result?.ok);
};

const schedulePersist = (name) => {
  if (!supabaseClient.isEnabled) return;
  const state = pendingWrites.get(name) || { dirty: false, running: false, timer: null };
  state.dirty = true;
  pendingWrites.set(name, state);
  if (state.timer || state.running) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushPersist(name);
  }, 250);
};

const flushPersist = async (name) => {
  const state = pendingWrites.get(name);
  if (!state || state.running) return;
  state.running = true;
  try {
    while (state.dirty) {
      state.dirty = false;
      const snapshot = deepClone(cache.docs[name]);
      const result = await supabaseClient.upsertRows(STATE_DOCS_TABLE, [{ name, data: snapshot }], "name");
      if (!result?.ok) {
        console.error(`No se pudo guardar el estado ${name} en Supabase:`, result?.status || result?.error || 'sin respuesta');
        state.dirty = true;
        break;
      }
    }
  } catch (error) {
    console.error(`No se pudo guardar el estado ${name} en Supabase:`, error?.message || error);
    state.dirty = true;
  } finally {
    state.running = false;
    if (state.dirty && !state.timer) state.timer = setTimeout(() => { state.timer = null; void flushPersist(name); }, 5000);
  }
};

const bootstrap = async () => {
  if (cache.ready) return cache.docs;
  if (cache.bootstrapping) return cache.bootstrapping;

  cache.bootstrapping = (async () => {
    ensureDataDir();
    cache.docs = {};
    if (supabaseClient.isEnabled) {
      const { ok, data } = await supabaseClient.selectRows(STATE_DOCS_TABLE).catch(() => ({ ok: false, data: [] }));
      if (ok && Array.isArray(data)) {
        for (const row of data) {
          if (!row?.name) continue;
          cache.docs[row.name] = normalizeDoc(row.name, row.data);
        }
      }
    }

    for (const name of Object.keys(DEFAULT_DOCS)) {
      if (cache.docs[name] && Object.keys(cache.docs[name]).length) continue;
      const legacy = readLegacyDoc(name);
      if (legacy !== null) {
        cache.docs[name] = normalizeDoc(name, legacy);
      } else {
        cache.docs[name] = normalizeDoc(name, DEFAULT_DOCS[name]);
      }
    }

    if (supabaseClient.isEnabled) {
      await Promise.all(Object.keys(DEFAULT_DOCS).map((name) => persistDoc(name)));
    }

    cache.ready = true;
    return cache.docs;
  })();

  return cache.bootstrapping;
};

const getDoc = (name) => normalizeDoc(name, cache.docs[name] ?? DEFAULT_DOCS[name]);

const setDoc = (name, data) => {
  cache.docs[name] = normalizeDoc(name, data);
  schedulePersist(name);
  return cache.docs[name];
};

const replaceDocs = (docs) => {
  for (const [name, data] of Object.entries(docs || {})) {
    cache.docs[name] = normalizeDoc(name, data);
  }
};

module.exports = {
  bootstrap,
  getDoc,
  setDoc,
  replaceDocs,
  DEFAULT_DOCS
};
