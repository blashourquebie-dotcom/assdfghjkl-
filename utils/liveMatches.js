const api=require('./supabaseClient');
const number=(v,max=86400)=>{if(!Number.isFinite(v)||v<0||v>max)throw Error('Número fuera de rango');return v;};
const integer=(v,max)=>{number(v,max);if(!Number.isInteger(v))throw Error('Entero requerido');return v;};
const text=(v,max=80)=>{if(typeof v!=='string'||v.length>max)throw Error('Texto inválido');return v;};
function validateStadium(s){
 const color=v=>{if(typeof v!=='string'||!/^#[a-f0-9]{6}$/i.test(v))throw Error('Color inválido');return v;};
 const coordinate=v=>{if(!Number.isFinite(v)||Math.abs(v)>20000)throw Error('Coordenada inválida');return v;};
 if(!s||s.width<100||s.height<100||typeof s.grass!=='boolean'||!Array.isArray(s.segments)||s.segments.length>256||!Array.isArray(s.discs)||s.discs.length>64)throw Error('Mapa inválido');
 return {name:text(s.name,100),width:number(s.width,10000),height:number(s.height,10000),color:color(s.color),grass:s.grass,kickOffRadius:number(s.kickOffRadius,1000),
  segments:s.segments.map(l=>{if(!Number.isFinite(l.curve)||Math.abs(l.curve)>340)throw Error('Curva inválida');return{x1:coordinate(l.x1),y1:coordinate(l.y1),x2:coordinate(l.x2),y2:coordinate(l.y2),curve:l.curve,color:color(l.color)};}),
  discs:s.discs.map(d=>({x:coordinate(d.x),y:coordinate(d.y),radius:number(d.radius,1000),color:color(d.color)}))};
}
function validateSnapshot(s){
 if(!s||typeof s!=='object'||!['1T','2T','1TE','2TE','GDO'].includes(s.stage)||!['live','interval','finished'].includes(s.status)||typeof s.running!=='boolean')throw Error('Estado inválido');
 if(!Array.isArray(s.players)||s.players.length>60||!Array.isArray(s.events)||s.events.length>1000)throw Error('Límite de eventos o jugadores');
 const players=s.players.map(p=>{
  if(![1,2].includes(p.team))throw Error('Equipo inválido');
  return {id:text(p.id,90),name:text(p.name),team:p.team,goals:integer(p.goals,200),assists:integer(p.assists,200),yellow:integer(p.yellow,2),red:integer(p.red,1),samples:integer(p.samples,172800),x:number(p.x,1),y:number(p.y,1),cleanSheetSeconds:integer(p.cleanSheetSeconds||0,Math.floor(s.seconds)),keeperSeconds:number(p.keeperSeconds||0,s.seconds)};
 });
 const events=s.events.map(e=>{
  if(!['goal','own_goal','yellow','red','period','pause','resume','end'].includes(e.type)||![0,1,2].includes(e.team)||!['1T','2T','1TE','2TE','GDO'].includes(e.stage)||e.seconds>s.seconds+.1)throw Error('Evento inválido');
  return {id:integer(e.id,100000),type:e.type,team:e.team,name:text(e.name),assist:text(e.assist||''),seconds:number(e.seconds),stage:text(e.stage,4)};
 });
 if(new Set(events.map(e=>e.id)).size!==events.length||new Set(players.map(p=>p.id)).size!==players.length)throw Error('IDs duplicados');
 if(s.status!=='live'&&s.running)throw Error('Reloj inválido');
 for(const team of [1,2])if(events.filter(e=>e.team===team&&['goal','own_goal'].includes(e.type)).length!==s[team===1?'home':'away'])throw Error('Marcador sin eventos de respaldo');
 return {stage:s.stage,status:s.status,running:s.running,seconds:number(s.seconds),home:integer(s.home,200),away:integer(s.away,200),revision:integer(s.revision||0,10000),control_version:integer(s.control_version,100000),players,events,...(s.stadium==null?{}:{stadium:validateStadium(s.stadium)})};
}
async function resolveIdentities(snapshot,identities,guildId){
 if(!snapshot||!identities)return;
 for(const player of snapshot.players){
   const proof=identities[player.id];if(typeof proof!=='string'||proof.length>160)continue;
   const session=require('./officials').getPendingSessionByValidationId(proof,guildId);
   if(!session||session.status!=='confirmed'||!session.matchedUserId||session.playerName!==player.name)continue;
   if(typeof session.playerId==='string'&&/^[a-f0-9-]{36}$/.test(session.playerId)){player.playerId=session.playerId;continue;}
   const found=await api.request('jugadores',{params:{select:'id',discord_guild_id:'eq.'+guildId,discord_user_id:'eq.'+session.matchedUserId,limit:2}});
   if(!found.ok)throw Error('No se pudo consultar el perfil vinculado');
   if(found.data?.length===1)player.playerId=found.data[0].id;
 }
}
async function handle(req,res,guildId,writeJson){
 if(req.method!=='POST')return writeJson(res,405,{error:'Usá POST'});
 if(!api.isEnabled)return writeJson(res,503,{error:'Sin conexión con la base de datos'});
 let bytes=0,chunks=[];
 try{
  for await(const chunk of req){bytes+=chunk.length;if(bytes>220000)return writeJson(res,413,{error:'Envío demasiado grande'});chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!/^[a-f0-9]{64}$/.test(body.token)||! /^[a-f0-9-]{36}$/.test(body.session))throw Error('ID o sesión inválidos');
  const snapshot=body.snapshot==null?null:validateSnapshot(body.snapshot);
  if(snapshot)await resolveIdentities(snapshot,body.identities,guildId);
  const result=await api.request('rpc/ingest_live_match',{method:'POST',body:{p_token:body.token,p_guild:guildId,p_session:body.session,p_seq:integer(body.seq,Number.MAX_SAFE_INTEGER),p_snapshot:snapshot}});
  if(!result.ok){let code='';try{code=JSON.parse(result.error).code;}catch{}return writeJson(res,code==='42501'?403:409,{error:code==='42501'?'ID revocado, sala ocupada o liga incorrecta':'No se pudo sincronizar. Verificá la migración y el estado del partido.'});}
  return writeJson(res,200,result.data);
 }catch{return writeJson(res,400,{error:'Datos de partido inválidos'});}
}
module.exports={handle,validateSnapshot};
