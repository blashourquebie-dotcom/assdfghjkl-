const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../utils/supabaseState");
const database = require("../utils/database");
const scope = require("../utils/tournamentScope");
const db = require("../utils/haxoleSupabase");
const command = require("../commands/verificarclub");

test("/verificarclub distingue rol, ficha, logo y vinculación web de la liga", async () => {
  const docs = { config: {}, users: { guilds: {} } };
  const originalGet = state.getDoc, originalSet = state.setDoc;
  const original = { isEnabled: db.isEnabled, getModalidadRow: db.getModalidadRow, getClubIdByName: db.getClubIdByName, request: db.request };
  state.getDoc = (key) => structuredClone(docs[key] || {});
  state.setDoc = (key, value) => { docs[key] = structuredClone(value); };
  db.isEnabled = true;
  db.getModalidadRow = async () => ({ id: "mod-x3" });
  db.getClubIdByName = async () => "club-ngw";
  db.request = async (path) => path === "clubes"
    ? { ok: true, data: [{ id: "club-ngw", nombre: "NGW", logo_url: null, emoji_url: null }] }
    : { ok: true, data: [{ data: { guilds: { "1293616776747286631": { clubs: { NGW: { roles: { x3: "role-ngw" } } } } } } }] };
  try {
    await database.withGuild("1293616776747286631", () => scope.run({ guildId: "1293616776747286631" }, async () => {
      const cfg = database.readConfig();
      cfg.enabledModalities = ["x3"];
      cfg.clubs = { NGW: { abbr: "NGW", roles: { x3: "role-ngw" } } };
      cfg.enabledRoles = { "1293616776747286631": { x3: [{ roleId: "role-ngw", name: "NGW" }] } };
      database.saveConfig(cfg);
      let response;
      await command.execute({
        guildId: "1293616776747286631", guild: { id: "1293616776747286631", roles: { fetch: async () => ({ id: "role-ngw" }) } },
        member: { permissions: { has: () => true } },
        options: { getString: (name) => name === "club" ? "NGW" : "x3", getBoolean: () => false },
        deferReply: async () => {}, editReply: async (payload) => { response = payload; return payload; }
      });
      assert.match(response.content, /Rol Discord: ✅/);
      assert.match(response.content, /Ficha web: ✅/);
      assert.match(response.content, /Escudo web: ❌/);
      assert.match(response.content, /Liga y modalidad sincronizadas: ✅/);
      assert.match(response.content, /\/ash\/modalidad\/mod-x3/);
    }));
  } finally {
    state.getDoc = originalGet; state.setDoc = originalSet;
    Object.assign(db, original);
  }
});
