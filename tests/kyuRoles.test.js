const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../utils/kyu-backend/server.cjs');
const admin={type:2,guild_id:'guild',member:{user:{id:'user'},roles:[],permissions:'32'},data:{name:'instalaciónkyu'}};
function create(env={},roles=[]){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kyu-roles-test-'));
 const calls=[];
 const service=createService({DATA_FILE:path.join(directory,'db.json'),DISCORD_GUILD_ID:'guild',...env},async(url,options)=>{
  calls.push({url,options});assert.equal(options.method,'GET','these fixtures must never create or assign roles');
  return Response.json(roles);
 });
 return {service,calls};
}
test('Discord failure is not reported as a missing Kyu role',async()=>{
 const {service,calls}=create();
 await assert.rejects(service.command({...admin,member:{...admin.member,permissions:'0'},data:{name:'cv'}}),error=>error.status===503&&/Discord no disponible/.test(error.message));
 assert.ok(calls.length>0);
});
test('installation uses explicit IDs and reports them for persistent configuration',async()=>{
 const {service}=create({KYU_PLAYER_ROLE_ID:'chosen'},[{id:'duplicate',name:'kyu'},{id:'chosen',name:'kyu'},{id:'pro',name:'pro'},{id:'plus',name:'pro+'},{id:'beta',name:'beta'},{id:'ver',name:'ver'}]);
 const result=await service.command(admin);
 assert.match(result.content,/KYU_PLAYER_ROLE_ID=chosen/);
 assert.equal(service.cfg.playerRole,'chosen');
});
test('installation refuses wrong explicit IDs and ambiguous names instead of silently choosing',async()=>{
 const {service}=create({KYU_PLAYER_ROLE_ID:'wrong'},[{id:'actual',name:'kyu'}]);
 await assert.rejects(service.command(admin),/no corresponde a un rol/);
 const ambiguous=create({},[{id:'a',name:'kyu'},{id:'b',name:'KYU'}]);
 await assert.rejects(ambiguous.service.command(admin),/Hay varios roles/);
});
