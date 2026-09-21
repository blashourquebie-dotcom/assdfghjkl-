const test=require('node:test'),assert=require('node:assert/strict');
const {selectClubs}=require('../utils/packTournamentSelection');
test('pack selection allows only local enabled clubs, other packs, unique canonical names',()=>{
 const cfg={clubs:{Raven:{abbr:'RAV',pack:'one',roles:{x3:'123'}},Mineiro:{abbr:'AM',pack:'two',roles:{x3:'456'}},Other:{roles:{x4:'789'}}}};
 assert.deepEqual(selectClubs('RAV\nMineiro\nRaven','x3',cfg),['Raven','Mineiro']);
 assert.throws(()=>selectClubs('Other','x3',cfg),/no habilitado/);
 assert.throws(()=>selectClubs('Unknown','x3',cfg),/no habilitado/);
 assert.throws(()=>selectClubs('','x3',cfg),/Elegí/);
});
