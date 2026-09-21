const { readConfig, saveConfig } = require("./database");
const roleRegistry = require("./roleRegistry");

const DAY_ALIASES = {
  domingo: 0,
  dom: 0,
  lunes: 1,
  lun: 1,
  martes: 2,
  mar: 2,
  miercoles: 3,
  "miércoles": 3,
  mie: 3,
  jueves: 4,
  jue: 4,
  viernes: 5,
  vie: 5,
  sabado: 6,
  "sábado": 6,
  sab: 6
};

const nowArgentina = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));

const dateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseDays = (raw) => Array.from(new Set(String(raw || "")
  .split(/[\s,]+/)
  .map((part) => part.toLowerCase().trim().replace(/^dias?:/i, ""))
  .map((part) => DAY_ALIASES[part])
  .filter((day) => Number.isInteger(day))));

const getMarket = (cfg, modality) => cfg.markets?.[roleRegistry.normalizeModality(modality)];
const ownerConfirmations = new Map();
const OWNER_CONFIRMATION_TTL_MS = 60 * 1000;

const parseDuration = (raw) => {
  const value = String(raw || "").toLowerCase().trim();
  if (!value) return null;

  let totalMs = 0;
  const regex = /(\d+)\s*(d|dia|dias|h|hs|hora|horas)\b/g;
  let match;
  while ((match = regex.exec(value))) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!amount) continue;
    totalMs += unit.startsWith("d") ? amount * 86400000 : amount * 3600000;
  }

  return totalMs > 0 ? totalMs : null;
};

const formatRemaining = (expiresAt) => {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "0h";
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const minutes = Math.ceil((diffMs % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const refreshTimedMarket = (cfg, mod, market) => {
  if (!market?.manualUntil) return false;
  const expiresAt = new Date(market.manualUntil).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return false;
  market.open = false;
  market.forceClosed = false;
  delete market.manualUntil;
  delete market.manualMode;
  market.updatedAt = new Date().toISOString();
  saveConfig(cfg);
  return true;
};

const isMarketOpen = (market) => {
  if (!market) return { open: true, reason: "sin_config" };
  if (market.forceClosed) return { open: false, reason: market.manualUntil ? "cerrado_temporal" : "cerrado_manual" };
  if (market.open) return { open: true, reason: market.manualUntil ? "abierto_temporal" : "abierto_manual" };
  const today = nowArgentina().getDay();
  return { open: (market.days || []).includes(today), reason: "dias_configurados" };
};

const currentPeriodKey = (market) => {
  const days = market?.days || [];
  const now = nowArgentina();
  const today = now.getDay();
  if (!days.includes(today)) return null;

  let start = new Date(now);
  for (let offset = 0; offset < 7; offset += 1) {
    const cursor = new Date(now);
    cursor.setDate(now.getDate() - offset);
    const previous = new Date(cursor);
    previous.setDate(cursor.getDate() - 1);
    if (!days.includes(previous.getDay())) {
      start = cursor;
      break;
    }
  }
  return dateKey(start);
};

const ensureFreshPeriod = (cfg, mod, market, state) => {
  if (!market || state.reason !== "dias_configurados") return false;
  const periodKey = currentPeriodKey(market);
  if (!periodKey || market.periodKey === periodKey) return false;
  market.periodKey = periodKey;
  market.usage = {};
  market.bonus = {};
  market.lastAutoResetAt = new Date().toISOString();
  saveConfig(cfg);
  return true;
};

const nextOpenText = (market) => {
  if (market?.forceClosed && market.manualUntil) {
    return `estado temporal termina en ${formatRemaining(market.manualUntil)}`;
  }
  const days = market?.days || [];
  if (!days.length) return "sin fecha configurada";
  const now = nowArgentina();
  const today = now.getDay();
  const sortedOffsets = days
    .map((day) => (day - today + 7) % 7)
    .filter((offset) => offset > 0)
    .sort((a, b) => a - b);
  const offset = sortedOffsets[0] ?? 7;
  const target = new Date(now);
  target.setDate(now.getDate() + offset);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  const daysLeft = Math.floor(diffMs / 86400000);
  const hoursLeft = Math.floor((diffMs % 86400000) / 3600000);
  return `${daysLeft}d ${hoursLeft}h`;
};

const buildOwnerConfirmationKey = ({ guildId, actorId, club, modality, amount, confirmationKey }) => [
  guildId || "global",
  actorId || "unknown",
  roleRegistry.normalizeModality(modality) || "unknown",
  String(club || "").toLowerCase(),
  Number(amount || 0),
  String(confirmationKey || "")
].join(":");

const consumeOwnerConfirmation = (input) => {
  const key = buildOwnerConfirmationKey(input);
  const now = Date.now();
  const expiresAt = ownerConfirmations.get(key) || 0;
  ownerConfirmations.set(key, now + OWNER_CONFIRMATION_TTL_MS);

  for (const [storedKey, storedExpiresAt] of ownerConfirmations.entries()) {
    if (storedExpiresAt < now) ownerConfirmations.delete(storedKey);
  }

  return expiresAt >= now;
};

const checkSigningAllowance = ({ club, modality, amount, guildId = null, actorId = null, guildOwnerId = null, confirmationKey = "" }) => {
  const cfg = readConfig();
  const mod = roleRegistry.normalizeModality(modality);
  const market = getMarket(cfg, mod);
  refreshTimedMarket(cfg, mod, market);
  const state = isMarketOpen(market);
  ensureFreshPeriod(cfg, mod, market, state);
  if (!state.open) {
    if (actorId && guildOwnerId && String(actorId) === String(guildOwnerId)) {
      const confirmed = consumeOwnerConfirmation({ guildId, actorId, club, modality: mod, amount, confirmationKey });
      if (confirmed) return { ok: true, ownerOverride: true };
      return {
        ok: false,
        needsOwnerConfirmation: true,
        message: [
          `El mercado esta cerrado. El mercado abrira en: ${nextOpenText(market)}`,
          "Como sos owner, podes fichar igual, pero tenes que revalidarlo.",
          "Repeti exactamente el mismo comando dentro de 60 segundos para confirmar."
        ].join("\n")
      };
    }
    return {
      ok: false,
      message: `El mercado esta cerrado. El mercado abrira en: ${nextOpenText(market)}`
    };
  }

  const max = Number(market?.maxSignings || 0);
  if (max <= 0) return { ok: true };

  const key = String(club || "").toLowerCase();
  const used = Number(market.usage?.[key] || 0);
  const bonus = Number(market.bonus?.[key] || 0);
  const allowed = max + bonus;
  if (used + amount > allowed) {
    if (used >= allowed) {
      return {
        ok: false,
        message: `Ya has utilizado tus ${allowed} fichajes semanales. Si quieres mas cargas puedes comprarlo abriendo ticket.`
      };
    }
    return {
      ok: false,
      message: `Estas fichando a ${amount} usuarios para ${club}, el limite es ${allowed} por semana. Si quieres mas cargas puedes comprarlo abriendo ticket.`
    };
  }

  return { ok: true };
};

const registerSignings = ({ club, modality, amount }) => {
  const cfg = readConfig();
  const mod = roleRegistry.normalizeModality(modality);
  const market = getMarket(cfg, mod);
  if (!market || Number(market.maxSignings || 0) <= 0) return;
  refreshTimedMarket(cfg, mod, market);
  ensureFreshPeriod(cfg, mod, market, isMarketOpen(market));
  const key = String(club || "").toLowerCase();
  market.usage = market.usage || {};
  market.usage[key] = Number(market.usage[key] || 0) + amount;
  saveConfig(cfg);
};

module.exports = {
  parseDays,
  parseDuration,
  formatRemaining,
  checkSigningAllowance,
  registerSignings
};
