const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('auth shared across authorized guilds; ownership conflict denied and removal global',()=>{
 let store={linksByGuild:{},pendingSessions:{},playerAliasesByGuild:{}};
 const allowed=['ash','rtg','theme'];
 const sandbox={module:{exports:{}},require:name=>{
  if(name==='crypto')return require(name);
  if(name==='./database')return {readConfig:()=>({})};
  if(name==='./tournamentScope')return {allowedGuild:id=>allowed.includes(id)};
  if(name==='./supabaseState')return {getDoc:()=>store,setDoc:(_,value)=>{store=value}};
  throw Error(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../utils/officials.js'),'utf8'),sandbox);
 const api=sandbox.module.exports;
 assert(api.addAuthLink({guildId:'ash',userId:'one',auth:'auth-A'}).ok);
 assert.equal(api.findLinkedDiscord({guildId:'rtg',auth:'auth-A'}).userId,'one');
 assert.equal(api.findLinkedDiscord({guildId:'theme',auth:'auth-A'}).userId,'one');
 assert.equal(api.findLinkedDiscord({guildId:'unknown',auth:'auth-A'}),null);
 assert.equal(api.addAuthLink({guildId:'rtg',userId:'two',auth:'auth-A'}).ok,false);
 store.linksByGuild.theme={two:{links:[{auth:'auth-A'}]}};
 assert.equal(api.findLinkedDiscord({guildId:'ash',auth:'auth-A'}),null);
 delete store.linksByGuild.theme;
 assert(api.removeAuthLink({guildId:'rtg',userId:'one',auth:'auth-A'}).ok);
 assert.equal(api.findLinkedDiscord({guildId:'ash',auth:'auth-A'}),null);
});
test('Discord confirmation defers before side effects and accepts a matching DM user',async()=>{
 const session={status:'pending',guildId:'ash',matchedUserId:'one',createdAt:new Date().toISOString()};
 const calls=[];
 const sandbox={module:{exports:{}},require:name=>{
  if(name==='discord.js')return require(name);
  if(name==='../utils/officials')return {getPendingSession:()=>structuredClone(session),updatePendingSession:(_,p)=>{calls.push('update');Object.assign(session,p);return structuredClone(session);},addPlayerAlias:()=>{}};
  if(name==='../utils/alerts')return {sendAlert:async()=>{}};
  if(name==='../utils/antiDu')return {recordValidation:async(_,confirmed)=>{assert.equal(calls[0],'defer');assert.equal(confirmed.status,'confirmed');assert(confirmed.confirmedAt);}};
  throw Error(name);
 },console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../commands/validarauth.js'),'utf8'),sandbox);
 await sandbox.module.exports.handleComponent({
 user:{id:'one'},guildId:null,client:{guilds:{fetch:async()=>null}},
 deferReply:async()=>calls.push('defer'),editReply:async()=>calls.push('edit'),
 message:{edit:async()=>{}}
 },['confirm','session']);
 assert.equal(session.status,'confirmed');assert.equal(calls[0],'defer');assert.equal(calls.at(-1),'edit');
});
