const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
 const calls=[], replies=[];let fail=false;
 const db={ensureClubRow:async()=>({id:'new'}),request:async(path,options)=>{
  calls.push({path,options});
  if(path==='torneos')return {ok:true,data:[{id:'t'}]};
  if(path==='rpc/tournament_replacement_candidates')return {ok:true,data:[{club_id:'old',nombre:'Galatasaray',vacant:true,posicion:4}]};
  return fail?{ok:false,error:'Conflict'}:{ok:true,data:2};
 }};
 const club={name:'Entrante',roles:{x4:'123'}};
 const mocks={'../utils/haxoleSupabase':db,'../utils/clubs':{findClub:()=>club,getRoleForClub:(c,m)=>c.roles[m],getAllClubs:()=>[club,{name:'Baja',roles:{}}]},'../utils/tournamentScope':{currentLeague:()=> 'exclusivo'},'../utils/roleRegistry':{normalizeModality:m=>m,getEnabledModalities:()=>['x4']},'../utils/database':{readConfig:()=>({})}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../commands/remplaza'),'utf8'),{module,require:name=>mocks[name]||require(name)});
 const interaction={guildId:'1400962843674804264',member:{permissions:{has:()=>true}},options:{getString:name=>name==='modalidad'?'x4':name==='club_remplazador'?'Entrante':'old',getFocused:()=>({name:'club_remplazador',value:''})},deferReply:async()=>{},editReply:async r=>replies.push(r),reply:async r=>replies.push(r),respond:async r=>replies.push(r)};
 return {command:module.exports,interaction,calls,replies,setFail(){fail=true;}};
}
test('remplaza is admin-only, uses a single atomic RPC and scopes outgoing choices',async()=>{
 const s=setup();await s.command.execute(s.interaction);
 const rpc=s.calls.find(c=>c.path==='rpc/bot_replace_active_club');
 assert.equal(rpc.options.body.p_old,'old');assert.equal(rpc.options.body.p_new,'new');
 assert.equal(s.calls[0].options.params['modalidad.nombre'],'eq.x4');assert.equal(rpc.options.body.p_modality,'x4');
 assert.match(s.replies[0].content,/2 torneo/);
 const denied=setup();denied.interaction.member.permissions.has=()=>false;
 await denied.command.execute(denied.interaction);assert.equal(denied.calls.length,0);
});
test('autocomplete excludes disabled clubs and failed RPC is not announced as success',async()=>{
 const s=setup();await s.command.autocomplete(s.interaction);
 assert.equal(s.replies[0].length,1);assert.equal(s.replies[0][0].name,'Entrante');
 s.setFail();await s.command.execute(s.interaction);assert.match(s.replies[1].content,/No se realizó/);
 assert.equal(s.command.data.toJSON().name,'remplaza');
});
