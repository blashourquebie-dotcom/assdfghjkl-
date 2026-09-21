const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const calls=[];let result={ok:true,data:{version:0}};
let identity={status:'confirmed',matchedUserId:'discord',playerName:'belga'};
const context={module:{exports:{}},Buffer,require:name=>name==='./officials'?{getPendingSessionByValidationId:(proof,guild)=>proof==='validated'&&guild==='1293616776747286631'?identity:null}:{isEnabled:true,request:async(...args)=>{calls.push(args);return args[0]==='jugadores'?{ok:true,data:[{id:'00000000-0000-0000-0000-000000000011'}]}:result;}}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../utils/liveMatches.js'),'utf8'),context);
const {handle,validateSnapshot}=context.module.exports;
const snapshot={stage:'1T',status:'live',running:true,seconds:10,home:0,away:0,control_version:0,players:[],events:[],token:'must not be public'};
const cleaned=validateSnapshot(snapshot);assert.equal(cleaned.token,undefined);
const stadium={name:'RS x4',width:1150,height:600,color:'#718c5a',grass:true,kickOffRadius:150,segments:[{x1:-1150,y1:-600,x2:1150,y2:-600,curve:0,color:'#ffffff'}],discs:[{x:-1150,y:100,radius:8,color:'#ffffff'}],token:'private'};
const mapped=validateSnapshot({...snapshot,stadium});assert.equal(mapped.stadium.token,undefined);assert.equal(mapped.stadium.segments.length,1);
assert.equal(cleaned.stadium,undefined,'older hosts remain compatible');
for(const bad of [{...stadium,color:'url(https://example.test)'},{...stadium,width:NaN},{...stadium,segments:Array(257).fill(stadium.segments[0])},{...stadium,discs:[{...stadium.discs[0],x:Infinity}]}])assert.throws(()=>validateSnapshot({...snapshot,stadium:bad}));
for(const bad of [{...snapshot,home:1},{...snapshot,seconds:NaN},{...snapshot,status:'finished'},{...snapshot,players:Array(61).fill({})}])assert.throws(()=>validateSnapshot(bad));
const valid={token:'a'.repeat(64),session:'00000000-0000-0000-0000-000000000001',seq:1,snapshot};
async function request(body,method='POST'){
 let response;const req={method,async *[Symbol.asyncIterator](){yield Buffer.from(typeof body==='string'?body:JSON.stringify(body));}};
 await handle(req,{},'1293616776747286631',(_,status,data)=>{response={status,data};});return response;
}
(async()=>{
 assert.equal((await request(valid)).status,200);assert.equal(calls[0][1].body.p_snapshot.token,undefined);assert.equal(calls[0][1].body.p_guild,'1293616776747286631');
 const player={id:'1',name:'belga',team:1,goals:0,assists:0,yellow:0,red:0,samples:10,x:0,y:.5,cleanSheetSeconds:10,keeperSeconds:10,playerId:'forged'};
 const final={...valid,snapshot:{...snapshot,status:'finished',running:false,players:[player]},identities:{1:'validated'}};
 assert.equal((await request(final)).status,200);assert.equal(calls.at(-1)[1].body.p_snapshot.players[0].playerId,'00000000-0000-0000-0000-000000000011');
 identity={...identity,status:'pending'};assert.equal((await request(final)).status,200);assert.equal(calls.at(-1)[1].body.p_snapshot.players[0].playerId,undefined,'unconfirmed/forged identity is never accepted');
 assert.equal((await request('{')).status,400);assert.equal((await request({...valid,token:'invalid'})).status,400);assert.equal((await request(valid,'GET')).status,405);assert.equal((await request('x'.repeat(220001))).status,413);
 result={ok:false,error:JSON.stringify({code:'42501'})};assert.equal((await request(valid)).status,403);
 result={ok:false,error:'unavailable'};assert.equal((await request(valid)).status,409);
 console.log('Live gateway: method, body size, IDs, score/event consistency, sanitized snapshots and authorization errors OK.');
})().catch(e=>{console.error(e);process.exitCode=1;});
