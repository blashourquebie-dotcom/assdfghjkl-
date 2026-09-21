const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let authorized=true,finished=true,ready=false,uploads=0,metadata=0;
const api={request:async(name,{body})=>{
 if(name==='rpc/ingest_live_match')return {ok:authorized,data:{snapshot:{status:finished?'finished':'live'}}};
 metadata++;if(body.p_ready)ready=true;return {ok:true,data:{ready,path:'official/test.hbr2',id:'test'}};
},uploadOfficialReplay:async()=>{uploads++;}};
const ctx={module:{exports:{}},Buffer,require:name=>name==='./supabaseClient'?api:require(name)};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../utils/liveReplays.js'),'utf8'),ctx);
const bytes=Buffer.alloc(16);bytes.write('HBR2');
async function run(data=bytes){let result;await ctx.module.exports.handle({method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},async *[Symbol.asyncIterator](){yield data;}},{},'ash',new URL('http://test?session=00000000-0000-0000-0000-000000000001'),(_,status,payload)=>result={status,payload});return result;}
(async()=>{
 authorized=false;assert.equal((await run()).status,403);assert.equal(uploads,0);authorized=true;
 finished=false;assert.equal((await run()).status,409);finished=true;
 assert.equal((await run(Buffer.alloc(16))).status,400);assert.equal((await run(Buffer.alloc(10485761))).status,413);
 assert.equal((await run()).status,200);assert.equal(uploads,1);assert(ready);assert.equal(metadata,2);
 assert.equal((await run()).status,200);assert.equal(uploads,1,'lost ACK does not upload again');
 console.log('REC gateway: credentials, finished-only, HBR2 header, cap, storage then publication and idempotent retries OK.');
})().catch(e=>{console.error(e);process.exitCode=1;});
