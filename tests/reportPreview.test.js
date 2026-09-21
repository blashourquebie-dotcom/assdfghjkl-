const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReport } = require('../utils/reportParser');
const { reportPreview } = require('../utils/reportPreview');
test('Reporte con emojis: premios postfijos, nombres con paréntesis y autogoles no crean jugadores falsos', () => {
 const raw = ':aa: 4 - 1 :bb:\n:aa: Uno (GK) - Dos\n:bb: Tres\n:aa: goles: Dos x3\n:bb: goles: Tres x1\n:bb: autogoles: Tres x1\n:aa: valla: Uno (GK) 3:24\nMVP: Dos :aa:\ndest: Uno (GK) :aa: Tres :bb:';
 const parsed = parseReport(raw, token => ({name:token}));
 assert.equal(parsed.valid,true);
 assert.deepEqual(parsed.stats.map(p=>p.playerName),['Uno (GK)','Dos','Tres']);
 assert.equal(parsed.stats[1].es_mvp,true);
 assert.equal(parsed.stats[0].es_destacado,true);
 assert.equal(parsed.stats[2].es_destacado,true);
 assert.equal(parsed.stats[2].goles_contra,1);
 assert.equal(parsed.stats[2].asistencias,0);
 assert.equal(parsed.stats[0].valla_invicta_segundos,204);
 const preview = reportPreview(parsed);
 assert.match(preview,/3:24/); assert.match(preview,/👥/); assert.doesNotMatch(preview,/V:.*s|RESULTADO|G:.*A:/);
 assert.equal(parsed.warnings.length,0);
});
