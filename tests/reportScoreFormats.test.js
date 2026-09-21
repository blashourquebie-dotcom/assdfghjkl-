const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReport } = require('../utils/reportParser');
const club = token => ({name:token});
for (const separator of ['.', 'x', 'X', '-']) for (const df of ['', ' df']) {
 test('score separator ' + separator + df, () => {
  const r = parseReport(':edlp2: 1' + separator + '0 :rv:' + df, club);
  assert.equal(r.valid,true); assert.deepEqual(r.score,{local:1,away:0});
  assert.equal(r.df,!!df); assert.deepEqual(r.stats,[]);
 });
}
test('decimal clean-sheet time is not another score line', () => {
 const r = parseReport(':edlp2: 1.0 :rv:\n:edlp2: v: portero (06.56)',club);
 assert.equal(r.stats[0].valla_invicta_segundos,416);
});
