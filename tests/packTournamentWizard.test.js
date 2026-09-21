const test=require('node:test'),assert=require('node:assert/strict');
const wizard=require('../utils/tournamentWizard'),db=require('../utils/haxoleSupabase'),selection=require('../utils/packTournamentSelection');
test('pack wizard follows deferred reply and retries enrollment without duplicate tournament',async()=>{
 const originals={mod:db.ensureModalidad,request:db.request,resolve:selection.resolveClubs};let preview,modal,creates=0,enrolls=0;
 db.ensureModalidad=async()=>({id:'mode'});selection.resolveClubs=async()=>[{id:'a'},{id:'b'}];
 db.request=async(table,payload)=>{if(table==='torneos'){creates++;return{ok:true,data:[{id:'new-tournament'}]};}enrolls++;assert.equal(payload.body[0].posicion,1);return{ok:enrolls>1};};
 const interaction={deferred:true,user:{id:'admin'},guildId:'guild',member:{permissions:{has:()=>true}},reply:async()=>{throw Error('must follow up deferred command');},followUp:async p=>{if(p.embeds)preview=p;},showModal:async m=>{modal=m.toJSON();},awaitModalSubmit:async()=>{throw Error('timeout');},deferUpdate:async()=>{},editReply:async()=>{}};
 try{
  await wizard.begin(interaction,{name:'Liga',count:2,modality:'x3',formato:'liga',tipo:'ash',clubs:['Raven','Mineiro']});
  const row=preview.components[0].toJSON();assert.equal(row.components.length,5);
  const id=row.components[0].custom_id.split(':')[2];await wizard.handle(interaction,['clubs',id]);
  assert.equal(modal.components[0].components[0].value,'Raven\nMineiro');
  await wizard.handle(interaction,['save',id]);await wizard.handle(interaction,['save',id]);assert.equal(creates,1);assert.equal(enrolls,2);
 }finally{db.ensureModalidad=originals.mod;db.request=originals.request;selection.resolveClubs=originals.resolve;}
});
