const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildInitialFixture, buildNextRound } = require('../utils/tournamentFormat');
const teams = n => Array.from({ length: n }, (_, i) => ({ club_id: String(i), nombre: 'Club ' + i }));
for (const ida_vuelta of [false, true]) test('14 clubes: octavos, cuartos, semis y final; doble vuelta=' + ida_vuelta, () => {
  const config = { formato: 'copa', ida_vuelta, pases_libres: ['3', '9'] };
  const factor = ida_vuelta ? 2 : 1;
  const finish = rows => rows.map(m => ({ ...m, jugado: true, goles_local: m.vuelta === 1 ? 2 : 0, goles_visitante: 0 }));
  let rows = buildInitialFixture(teams(14), config);
  assert.equal(rows.length, 6 * factor);
  assert.ok(rows.every(m => !config.pases_libres.includes(m.club_local_id) && !config.pases_libres.includes(m.club_visitante_id)));
  assert.deepEqual([...new Set(rows.map(m => m.llave))], [3, 4, 5, 6, 7, 8]);
  rows = finish(rows);
  for (const size of [4, 2, 1]) {
    const next = buildNextRound(rows, config);
    assert.equal(next.rows.length, size * factor);
    if (size === 4) assert.equal(new Set(next.rows.flatMap(m => [m.club_local_id, m.club_visitante_id])).size, 8);
    rows.push(...finish(next.rows));
  }
  assert.ok(buildNextRound(rows, config).champion);
  assert.equal(rows.length, 13 * factor);
});
test('Rechaza clubes ajenos, pases repetidos y cantidades incorrectas', () => {
  for (const pases_libres of [[], ['0'], ['0', '0'], ['0', '99'], ['0', '1', '2']]) assert.throws(() => buildInitialFixture(teams(14), { formato: 'copa', pases_libres }), /exactamente/);
});
test('Copas de 3 a 32 participantes completan una única eliminación por club', () => {
  for (let n = 3; n <= 32; n++) {
    const count = 2 ** Math.ceil(Math.log2(n)) - n;
    const config = { formato: 'copa', pases_libres: teams(count).map(t => t.club_id) };
    const finish = rows => rows.map(m => ({ ...m, jugado: true, goles_local: 1, goles_visitante: 0 }));
    let rows = finish(buildInitialFixture(teams(n), config));
    for (let round = 0; round < 5; round++) {
      const next = buildNextRound(rows, config);
      if (next.champion) break;
      rows.push(...finish(next.rows));
    }
    assert.equal(rows.length, n - 1);
  }
});
