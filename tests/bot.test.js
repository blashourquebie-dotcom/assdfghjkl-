const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
// In-memory persistence: tests never touch the live bot documents.
const docs = { config: {}, users: {}, officials: {}, stats: { entries: [] } };
require.cache[require.resolve("../utils/supabaseState")] = { exports: {
  getDoc: (name) => structuredClone(docs[name] || {}),
  setDoc: (name, value) => { docs[name] = structuredClone(value); },
  bootstrap: async () => {}
} };
const database = require("../utils/database");
const { parseReport } = require("../utils/reportParser");
const { evaluate } = require("../utils/antiDu");

test("Todos los módulos de arranque y comandos cargan", () => {
  for (const directory of ["commands", "handlers", "utils"]) {
    for (const file of fs.readdirSync(path.join(__dirname, "..", directory)).filter((name) => name.endsWith(".js"))) require(path.join(__dirname, "..", directory, file));
  }
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const match of source.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)) assert.ok(require.resolve(path.join(__dirname, "..", match[1])));
});

test("Tres servidores mantienen fichajes, clubes y configuración independientes", async () => {
  for (const guildId of ["101", "102", "103"]) {
    await database.withGuild(guildId, async () => {
      const cfg = database.readConfig(); cfg.clubs = { [guildId]: { roles: {} } }; cfg.validationChannelId = guildId;
      cfg.antiDuOrigins = { ip: { fingerprint: [{ userId: guildId, at: '2026-01-01T00:00:00Z' }] } };
      database.saveConfig(cfg); database.saveUser("jugador", { clubRoles: { x3: guildId } });
      await Promise.resolve();
      assert.equal(database.readConfig().validationChannelId, guildId);
    });
  }
  for (const guildId of ["101", "102", "103"]) database.withGuild(guildId, () => {
    assert.deepEqual(Object.keys(database.readConfig().clubs), [guildId]);
    assert.equal(database.getUser("jugador").clubRoles.x3, guildId);
    assert.equal(database.readConfig().antiDuOrigins.ip.fingerprint[0].userId, guildId);
  });
});

test("Anti-DU aplica reglas y limita la visualización a 100", () => {
  const base = { userId: "uno", ip: "ip1", conn: "conn1", auth: "auth1" };
  assert.equal(evaluate([], base).percent, 0);
  assert.equal(evaluate([base], { ...base, ip: "ip2" }).score, 0);
  assert.equal(evaluate([base], { ...base, ip: "ip2", conn: "conn2" }).score, 0);
  assert.equal(evaluate([base], { ...base, ip: "ip2", conn: "conn2", auth: "auth2" }).score, 0);
  assert.equal(evaluate([base], { ...base, userId: "dos" }).percent, 100);
  assert.equal(evaluate([base], { ...base, userId: "dos" }).score, 150);
});

test("Parser: goles, asistencias, valla, aliases y MVP", () => {
  const report = parseReport(":AAA: 3x0 :BBB:\n:AAA: g: pepito:x3\n:AAA: a: juan x2\n:AAA: v: arquero (06.56)\nmvp: pepito", (token) => ({ name: token }), (name) => name === "pepito" ? "123" : null);
  assert.equal(report.score.local, 3);
  assert.equal(report.stats.find((row) => row.playerName === "pepito").goles, 3);
  assert.equal(report.stats.find((row) => row.playerName === "pepito").resolvedUserId, "123");
  assert.equal(report.stats.find((row) => row.playerName === "pepito").es_mvp, true);
  assert.equal(report.stats.find((row) => row.playerName === "arquero").valla_invicta_segundos, 416);
});

test("DF sin rival identificado no puede publicarse", () => {
  assert.equal(parseReport("1x0 :AAA: df", (token) => ({ name: token })).valid, false);
  const report = parseReport(":AAA: 1-0 :BBB: df", (token) => ({ name: token }));
  assert.equal(report.df, true); assert.deepEqual(report.stats, []);
});

test("Aprobaciones: aceptar una vez, rechazar sin publicar y conservar pendiente si falla", async () => {
  const command = require("../commands/vincularinformesaprobaciones");
  const cargarstat = require("../commands/cargarstat");
  const original = cargarstat.execute;
  let calls = 0;
  cargarstat.execute = async () => { calls++; return { reportSaved: true }; };
  try {
    await database.withGuild("approval-test", async () => {
      const cfg = database.readConfig();
      cfg.reportApprovalQueue = {};
      for (const id of ["accept", "reject", "fail"]) cfg.reportApprovalQueue[id] = { status: "pending", approvalChannelId: "review", approvalMessageId: id, sourceChannelId: "source", raw: "report" };
      database.saveConfig(cfg);
      const interaction = (id) => ({
        guildId: "approval-test", guild: { channels: { fetch: async () => ({ id: "source" }) } },
        member: { permissions: { has: () => true } }, user: { id: "admin" }, channelId: "review",
        message: { id, edit: async () => {} }, deferReply: async () => {}, reply: async () => {}, editReply: async () => {}
      });
      await command.handleComponent(interaction("accept"), ["accept", "accept"]);
      await command.handleComponent(interaction("accept"), ["accept", "accept"]);
      assert.equal(calls, 1);
      await command.handleComponent(interaction("reject"), ["reject", "reject"]);
      assert.equal(calls, 1);
      cargarstat.execute = async () => { throw new Error("database unavailable"); };
      await command.handleComponent(interaction("fail"), ["accept", "fail"]);
      assert.equal(database.readConfig().reportApprovalQueue.fail.status, "pending");
      assert.equal(database.readConfig().reportApprovalQueue.reject.status, "rejected");
    });
  } finally { cargarstat.execute = original; }
});
