const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildInitialFixture, buildNextRound, validateConfig } = require("../utils/tournamentFormat");
const teams = (n) => Array.from({ length: n }, (_, i) => ({ club_id: String(i), club: { nombre: "Club " + i } }));
const config = (formato, ida_vuelta = false) => ({ formato, ida_vuelta, clasifican: 2, etiquetas: [] });
test("Liga: todos contra todos, ida y vuelta", () => {
  const rows = buildInitialFixture(teams(8), config("liga", true));
  assert.equal(rows.length, 56);
  assert.equal(new Set(rows.map((m) => m.club_local_id + ":" + m.club_visitante_id)).size, 56);
});
test("Dos grupos de 8: cada club juega solo contra los de su grupo", () => {
  const rows = buildInitialFixture(teams(16), config("dos_grupos"));
  assert.equal(rows.length, 56);
  assert.equal(rows.filter((m) => m.grupo === "A").length, 28);
  assert.ok(rows.every((m) => Number(m.club_local_id) % 2 === Number(m.club_visitante_id) % 2));
});
test("Copa avanza ganadores por marcador agregado y finaliza", () => {
  let rows = buildInitialFixture(teams(4), config("copa", true)).map((m) => ({ ...m, jugado: true, goles_local: m.vuelta === 1 ? 3 : 0, goles_visitante: 0 }));
  const next = buildNextRound(rows, config("copa", true));
  assert.equal(next.rows.length, 2);
  assert.equal(next.rows[0].ronda, 2);
  rows = rows.concat(next.rows.map((m) => ({ ...m, jugado: true, goles_local: m.vuelta === 1 ? 2 : 0, goles_visitante: 0 })));
  assert.equal(buildNextRound(rows, config("copa", true)).champion, "0");
});
test("No avanza partidos pendientes ni llaves empatadas", () => {
  const rows = buildInitialFixture(teams(4), config("copa"));
  assert.throws(() => buildNextRound(rows, config("copa")), /pendientes/);
  assert.throws(() => buildNextRound(rows.map((m) => ({ ...m, jugado: true, goles_local: 1, goles_visitante: 1 })), config("copa")), /empatada/);
});
test("Valida tamaños y etiquetas", () => {
  assert.doesNotThrow(() => validateConfig(config("copa"), 6));
  assert.throws(() => buildInitialFixture(teams(6), config("copa")), /pase libre/);
  assert.throws(() => validateConfig({ ...config("liga"), etiquetas: [{ desde: 1, hasta: 9, color: "#116633", texto: "Campeón" }] }, 8), /Etiqueta/);
});

test("Dos grupos cruza primero contra segundo del otro grupo", () => {
  const cfg = config("dos_grupos");
  const rows = buildInitialFixture(teams(8), cfg).map((m) => ({
    ...m, jugado: true,
    goles_local: Number(m.club_local_id) < Number(m.club_visitante_id) ? 2 : 0,
    goles_visitante: Number(m.club_local_id) > Number(m.club_visitante_id) ? 2 : 0
  }));
  const next = buildNextRound(rows, cfg);
  assert.deepEqual(next.rows.map((r) => [r.club_local_id, r.club_visitante_id]), [["0", "3"], ["2", "1"]]);
  assert.ok(next.rows.every((r) => r.fase === "eliminacion" && r.grupo === null));
});

test("El borrador no crea torneos y bloquea usuarios ajenos", async () => {
  const wizard = require("../utils/tournamentWizard");
  let payload;
  await wizard.begin({ user: { id: "owner" }, guildId: "guild", reply: async (p) => { payload = p; } }, { name: "Prueba", count: 8, modality: "x4", tipo: "ash", formato: "liga" });
  const id = payload.components[0].components[0].data.custom_id.split(":")[2];
  let rejected;
  await wizard.handle({ user: { id: "other" }, guildId: "guild", reply: async (p) => { rejected = p; } }, ["save", id]);
  assert.match(rejected.content, /Solo el administrador/);
  let cancelled;
  await wizard.handle({ user: { id: "owner" }, guildId: "guild", member: { permissions: { has: () => true } }, update: async (p) => { cancelled = p; } }, ["cancel", id]);
  assert.equal(cancelled.components.length, 0);
});
