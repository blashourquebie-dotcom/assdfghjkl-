const test=require('node:test'),assert=require('node:assert/strict');
const {createFixtureBackupWorker}=require('../utils/fixtureBackups');
test('DM delivered before completion; a rejected DM never calls delete',async()=>{
 for(const fail of [false,true]){
  const calls=[];const db={isEnabled:true,selectRows:async()=>({ok:true,data:[{id:'job',discord_id:'1396189311455727636',snapshot:{tournament:{nombre:'Liga',tipo:'ash'},matches:[]}}]}),request:async(name,args)=>{calls.push(name);return{ok:true,data:name==='rpc/claim_fixture_delete'?'token':true};}};
  const client={users:{fetch:async id=>{assert.equal(id,'1396189311455727636');return{send:async payload=>{calls.push('DM');assert.match(payload.files[0].name,/\.txt$/);assert.match(payload.files[0].attachment.toString(),/RECUPERABLE/);if(fail)throw Object.assign(Error('blocked'),{code:50007});return{id:'12345'};}};}}};
  await createFixtureBackupWorker(client,db)();
  if(fail){assert.ok(!calls.includes('rpc/complete_fixture_delete'));assert.ok(calls.includes('fixture_delete_requests'));}
  else assert.ok(calls.indexOf('DM')<calls.indexOf('rpc/complete_fixture_delete'));
 }
});

test('un 404 de la tabla faltante no consulta Supabase cada quince segundos',async()=>{
 let calls=0;
 const db={isEnabled:true,selectRows:async()=>{calls++;return {ok:false,status:404};}};
 const warn=console.warn;
 console.warn=()=>{};
 try{
  const worker=createFixtureBackupWorker({},db);
  await worker();await worker();
  assert.equal(calls,1);
 }finally{console.warn=warn;}
});
