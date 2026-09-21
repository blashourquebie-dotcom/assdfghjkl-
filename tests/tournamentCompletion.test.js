const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertTournamentComplete: check } = require("../utils/tournamentCompletion");
const match = (home, away, extra = {}) => ({ club_local_id: home, club_visitante_id: away, jugado: true, goles_local: 1, goles_visitante: 0, ronda: 1, llave: 1, fase: "eliminacion", ...extra });
const league = { formato: "liga", cantidad_equipos: 3 };
test("league requires every unique fixture and valid played scores", () => {
 const complete = [match("a", "b"), match("a", "c"), match("b", "c")];
 assert.doesNotThrow(() => check(league, complete));
 for (const rows of [[], complete.slice(1), [...complete.slice(1), complete[1]], complete.map((m, i) => i ? m : { ...m, jugado: false }), complete.map((m, i) => i ? m : { ...m, goles_local: null })]) assert.throws(() => check(league, rows));
});
test("cup cannot finish after semifinals or tied final", () => {
 const cup = { formato: "copa", cantidad_equipos: 4 };
 const semis = [match("a", "b"), match("c", "d", { llave: 2 })];
 assert.throws(() => check(cup, semis));
 assert.doesNotThrow(() => check(cup, [...semis, match("a", "c", { ronda: 2 })]));
 assert.throws(() => check(cup, [...semis, match("a", "c", { ronda: 2, goles_visitante: 1 })]));
});
test("two-legged cup needs both final legs", () => {
 const cup = { formato: "copa", cantidad_equipos: 2, configuracion: { ida_vuelta: true } };
 assert.throws(() => check(cup, [match("a", "b")]));
 assert.doesNotThrow(() => check(cup, [match("a", "b"), match("b", "a", { goles_local: 0 })]));
});
