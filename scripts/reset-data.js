const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const readJson = (relPath) => {
  const raw = fs.readFileSync(path.join(root, relPath), "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
};

const writeJson = (relPath, value) => {
  fs.writeFileSync(path.join(root, relPath), JSON.stringify(value, null, 2));
};

const cfg = readJson("data/config.json");

const resetCfg = {
  enabledModalities: Array.isArray(cfg.enabledModalities) ? cfg.enabledModalities : [],
  enabledRoles: cfg.enabledRoles && typeof cfg.enabledRoles === "object" ? cfg.enabledRoles : {},
  generalRoles: cfg.generalRoles && typeof cfg.generalRoles === "object" ? cfg.generalRoles : {},
  enabledDTRoles: {},
  sanctionedRoles: {},
  roleLimits: {},
  clubs: {},
  archivedClubs: {},
  forumClubs: {},
  pendingTransfers: {},
  markets: {},
  guilds: {},
  meta: cfg.meta && typeof cfg.meta === "object" ? cfg.meta : {}
};

writeJson("data/config.json", resetCfg);
writeJson("data/users.json", {});
writeJson("data/sanctions.json", {});
writeJson("data/matches.json", []);
writeJson("data/officials.json", {});

console.log("Reset de datos completado.");
