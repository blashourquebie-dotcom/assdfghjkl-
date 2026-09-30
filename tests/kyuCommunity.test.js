const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createIntegration}=require('../utils/kyuApp');
test('gateway preserves beta message identity, serves buttons privately and never handles foreign buttons',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyu-community-gateway-')),file=path.join(dir,'db.json'),calls=[];
 fs.writeFileSync(file,JSON.stringify({beta:{id:'0123456789abcdef',role:'beta',channel:'channel',message:'message',limit:1,entries:{}}}));
 const integration=createIntegration({KYU_ENABLED:'0',KYU_GUILD_ID:'guild',KYU_DATA_FILE:file},async(url,o)=>{calls.push({url,...o});return new Response(null,{status:204});});t.after(()=>integration.close());
 const replies=[],i={guildId:'guild',channelId:'channel',message:{id:'message'},user:{id:'123456789012345678'},customId:'kyu:beta:0123456789abcdef',isButton:()=>true,isChatInputCommand:()=>false,member:{roles:[]},deferReply:async p=>replies.push(p),editReply:async p=>replies.push(p)};
 assert.equal(integration.handles({...i,customId:'unrelated'}),false);assert.equal(integration.handles(i),true);await integration.interaction(i);
 assert.equal(replies[0].flags,64);assert.match(replies[1].content,/Ya sos/);assert.deepEqual(replies[1].allowedMentions,{parse:[]});assert.equal(calls.filter(c=>c.method==='PUT').length,1);
 await integration.interaction(i);assert.equal(calls.filter(c=>c.method==='PUT').length,1);
 const rejected=[];await integration.interaction({...i,guildId:'other',reply:async p=>rejected.push(p)});assert.match(rejected[0].content,/no está habilitado/);
});
