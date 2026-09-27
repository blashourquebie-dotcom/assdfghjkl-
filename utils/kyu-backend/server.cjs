const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const {hash,token,authorize,verifyInteraction,duration,isAdmin}=require('./access.cjs');
const {ticketPanel}=require('./commands.cjs');
function createService(env=process.env,transport=fetch){
 const cfg={guild:env.DISCORD_GUILD_ID,playerRole:env.KYU_PLAYER_ROLE_ID,pro:env.KYU_PRO_ROLE_ID,proplus:env.KYU_PRO_PLUS_ROLE_ID,streamerRoles:(env.KYU_STREAMER_ROLE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean)};
 const dataFile=path.resolve(env.DATA_FILE||'data/kyu.json');let db={users:{},plans:{},friends:[],tickets:{},voices:{},roles:{},presence:null};
 try{db={...db,...JSON.parse(fs.readFileSync(dataFile,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
 // Explicit deployment role IDs take precedence over persisted installation data.
 // Never allow a stored roles object to override the guild or streamer policy.
 for(const key of ['playerRole','pro','proplus'])cfg[key]=String(cfg[key]||'').trim()||String(db.roles?.[key]||'').trim();
 const save=()=>{fs.mkdirSync(path.dirname(dataFile),{recursive:true});fs.writeFileSync(dataFile+'.tmp',JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(dataFile+'.tmp',dataFile)};
 const pairs=new Map(),states=new Map(),sessions=new Map(),rates=new Map(),seenInteractions=new Map();
 const ready=()=>!!(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET&&env.DISCORD_BOT_TOKEN&&cfg.guild&&env.PUBLIC_URL);
 async function discord(route,method='GET',body,auth='Bot '+env.DISCORD_BOT_TOKEN){const r=await transport('https://discord.com/api/v10'+route,{method,headers:{Authorization:auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Discord no disponible o permisos insuficientes ('+r.status+').');return r.status===204?null:r.json();}
 async function identity(id){
  if(!cfg.playerRole)throw new Error('El bot todavía no tiene configurado el ID del rol Kyu. Un administrador debe ejecutar /instalaciónkyu y guardar KYU_PLAYER_ROLE_ID en Railway.');
  const member=await discord(`/guilds/${cfg.guild}/members/${id}`);const rights=authorize(member,cfg);
  if(!rights.allowed)throw new Error(`La cuenta ${member.user?.username||id} no tiene el rol Kyu configurado (ID ${cfg.playerRole}) en el servidor ${cfg.guild}. Si ya tenés el rol kyu, revisá su ID en KYU_PLAYER_ROLE_ID; el nombre no alcanza.`);
  return {id,username:member.user?.global_name||member.user?.username||db.users[id]?.username||id,...rights};
 }
 async function session(req){const credential=(req.headers.authorization||'').replace(/^Bearer /,'');const key=hash(credential);const s=sessions.get(key);if(!s||s.expires<Date.now()){sessions.delete(key);throw new Error('Sesión vencida. Volvé a vincular Discord.');}try{s.user=await identity(s.user.id);}catch(e){sessions.delete(key);throw e;}return s;}
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 async function read(req){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>32768)throw new Error('Solicitud demasiado grande.');chunks.push(c)}return Buffer.concat(chunks);}
 const option=(i,name)=>i.data?.options?.find(o=>o.name===name)?.value;
 async function removePlan(id){const plan=db.plans[id];if(!plan)return;for(const role of [cfg.pro,cfg.proplus])if(role)await discord(`/guilds/${cfg.guild}/members/${id}/roles/${role}`,'DELETE');if(plan.grantedPlayer&&cfg.playerRole)await discord(`/guilds/${cfg.guild}/members/${id}/roles/${cfg.playerRole}`,'DELETE');delete db.plans[id];save();}
 async function command(i){
  const user=i.member?.user?.id;const name=i.data?.name;
  if(i.guild_id!==cfg.guild||!user)throw new Error('Servidor no autorizado.');
  const admin=isAdmin(i,cfg.guild);if(i.type===2&&!['cv','ticketcerrar'].includes(name)&&!admin)throw new Error('Necesitás Administrar servidor.');
  if(i.type===3&&i.data.custom_id==='kyu:ticket'){
   const kind=i.data.values?.[0];if(!['comprar','crear','reclamar','consultar'].includes(kind))throw new Error('Motivo inválido.');
   const old=Object.values(db.tickets).find(t=>t.user===user&&!t.closed);if(old)return {content:`Ya tenés un ticket: <#${old.channel}>`};
   if(!env.KYU_STAFF_ROLE_ID)throw new Error('Falta configurar el rol de soporte.');
   const channel=await discord(`/guilds/${cfg.guild}/channels`,'POST',{name:`ticket-${kind}-${user.slice(-6)}`,type:0,permission_overwrites:[{id:cfg.guild,type:0,deny:'1024'},{id:user,type:1,allow:'68608'},{id:env.KYU_STAFF_ROLE_ID,type:0,allow:'68608'}]});
   db.tickets[channel.id]={channel:channel.id,user,kind,closed:false};save();await discord(`/channels/${channel.id}/messages`,'POST',{content:`<@${user}> · ${kind}\nUn miembro de soporte te atenderá. Usá /ticketcerrar al terminar.`,allowed_mentions:{users:[user]}});return {content:`Tu ticket: <#${channel.id}>`};
  }
  if(name==='instalaciónkyu'){
   const roles=await discord(`/guilds/${cfg.guild}/roles`);
   const definitions=[['playerRole','kyu','KYU_PLAYER_ROLE_ID'],['pro','pro','KYU_PRO_ROLE_ID'],['proplus','pro+','KYU_PRO_PLUS_ROLE_ID']];
   const selected=definitions.map(([key,label,variable])=>{
    const explicit=String(env[variable]||'').trim();
    if(explicit){const r=roles.find(r=>r.id===explicit);if(!r)throw new Error(`${variable}=${explicit} no corresponde a un rol de este servidor. Corregí ese ID en Railway.`);return r;}
    const saved=roles.find(r=>r.id===cfg[key]);if(saved)return saved;
    const matches=roles.filter(r=>r.name.trim().toLowerCase()===label);
    if(matches.length>1)throw new Error(`Hay varios roles llamados ${label}. Configurá ${variable} con el ID correcto; no se elegirá uno al azar.`);
    return matches[0];
   });
   for(let n=0;n<definitions.length;n++){const [key,label]=definitions[n];const r=selected[n]||await discord(`/guilds/${cfg.guild}/roles`,'POST',{name:label,color:0xffadd0,permissions:'0',mentionable:false});cfg[key]=r.id;}
   db.roles={playerRole:cfg.playerRole,pro:cfg.pro,proplus:cfg.proplus};save();return {content:`Roles Kyu, Pro y Pro+ configurados. El bot debe estar por encima de ellos.\nPara conservar estos IDs tras un despliegue, guardá en Railway:\nKYU_PLAYER_ROLE_ID=${cfg.playerRole}\nKYU_PRO_ROLE_ID=${cfg.pro}\nKYU_PRO_PLUS_ROLE_ID=${cfg.proplus}\nNo hace falta quitarte ni volver a asignarte un rol que ya tenés.`};
  }
  if(name==='plan'){
   const id=option(i,'usuario'),plan=option(i,'plan'),expires=Date.now()+duration(option(i,'tiempo'));if(!['pro','proplus'].includes(plan)||!cfg[plan]||!cfg.playerRole)throw new Error('Ejecutá /instalaciónkyu primero.');
   const member=await discord(`/guilds/${cfg.guild}/members/${id}`);const grantedPlayer=db.plans[id]?.grantedPlayer||!member.roles.includes(cfg.playerRole);
   await discord(`/guilds/${cfg.guild}/members/${id}/roles/${cfg.playerRole}`,'PUT');await discord(`/guilds/${cfg.guild}/members/${id}/roles/${cfg[plan]}`,'PUT');
   const other=plan==='pro'?cfg.proplus:cfg.pro;if(other)await discord(`/guilds/${cfg.guild}/members/${id}/roles/${other}`,'DELETE');db.plans[id]={plan,expires,grantedPlayer};save();return {content:`Plan ${plan} para <@${id}> hasta <t:${Math.floor(expires/1000)}:f>.`};
  }
  if(name==='planremove'){await removePlan(option(i,'usuario'));return {content:'Plan retirado. No se quitaron roles jugador concedidos previamente por staff.'};}
  if(name==='jugadores'){const channel=option(i,'canal');const info=await discord(`/channels/${channel}`);if(info.guild_id!==cfg.guild||![0,5,10,11,12].includes(info.type))throw new Error('Elegí un canal de texto o hilo de este servidor.');const m=await discord(`/channels/${channel}/messages`,'POST',{content:'KyuApp · presencia en vivo\nTodavía no hay sesiones activas.'});db.presence={channel,message:m.id};save();return {content:'Lista vinculada. Se actualiza cada 30 segundos. Es presencia reportada por el cliente, no prueba anticrack.'};}
  if(name==='ticket'){await discord(`/channels/${i.channel_id}/messages`,'POST',ticketPanel());return {content:'Panel de atención publicado.'};}
  if(name==='ticketcerrar'){const ticket=db.tickets[i.channel_id];if(!ticket||ticket.closed)throw new Error('Este canal no es un ticket abierto.');const staff=env.KYU_STAFF_ROLE_ID&&i.member.roles.includes(env.KYU_STAFF_ROLE_ID);if(!admin&&!staff&&ticket.user!==user)throw new Error('No podés cerrar este ticket.');await discord(`/channels/${i.channel_id}/permissions/${ticket.user}`,'PUT',{type:1,allow:'66560',deny:'2048'});ticket.closed=true;save();return {content:'Ticket cerrado. El historial se conserva.'};}
  if(name==='cv'){if(!admin)await identity(user);const previous=db.voices[user];if(previous){try{const c=await discord(`/channels/${previous}`);return {content:`Ya tenés un canal: <#${c.id}>`};}catch{delete db.voices[user];}}
   const label=String(option(i,'nombre')||'Kyu').trim().slice(0,80);const permissions=[{id:cfg.guild,type:0,deny:'1049600'},{id:user,type:1,allow:'3146752'}];if(env.KYU_STAFF_ROLE_ID)permissions.push({id:env.KYU_STAFF_ROLE_ID,type:0,allow:'3146752'});const c=await discord(`/guilds/${cfg.guild}/channels`,'POST',{name:'🔒 '+label,type:2,permission_overwrites:permissions});db.voices[user]=c.id;save();return {content:`Canal privado: <#${c.id}>`};}
  throw new Error('Comando no reconocido.');
 }
 async function tick(){
  const now=Date.now();for(const [key,p]of pairs)if(p.expires<now)pairs.delete(key);for(const [key,s]of states)if(s.expires<now)states.delete(key);for(const [key,s]of sessions)if(s.expires<now)sessions.delete(key);for(const [key,r]of rates)if(r.at+60000<now)rates.delete(key);for(const [key,t]of seenInteractions)if(t+300000<now)seenInteractions.delete(key);
  for(const [id,p]of Object.entries(db.plans))if(p.expires<now)await removePlan(id);
  if(db.presence){const users=new Map();for(const s of sessions.values())if(now-s.lastSeen<75000)users.set(s.user.id,s.user);const list=[...users.values()].slice(0,45).map(u=>`• <@${u.id}>`).join('\n');await discord(`/channels/${db.presence.channel}/messages/${db.presence.message}`,'PATCH',{content:`KyuApp · ${users.size} sesiones activas\n${list||'Nadie conectado.'}\nActualizado <t:${Math.floor(now/1000)}:R> · presencia declarada, no verificación anticrack`,allowed_mentions:{parse:[]}});}
 }
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');const ip=req.socket.remoteAddress;let rate=rates.get(ip);if(!rate||Date.now()-rate.at>60000){rate={at:Date.now(),n:0};rates.set(ip,rate)}if(++rate.n>300)return json(res,429,{ok:false,error:'Demasiadas solicitudes.'});
  if(url.pathname==='/health')return json(res,200,{ok:true,configured:ready()});
  if(url.pathname==='/interactions'&&req.method==='POST'){
   const raw=await read(req);if(!verifyInteraction(raw,req.headers['x-signature-ed25519'],req.headers['x-signature-timestamp'],env.DISCORD_PUBLIC_KEY))return json(res,401,{error:'Firma inválida'});const i=JSON.parse(raw);if(i.type===1)return json(res,200,{type:1});if(seenInteractions.has(i.id))return json(res,409,{error:'Repetido'});seenInteractions.set(i.id,Date.now());json(res,200,{type:5,data:{flags:64}});
   command(i).catch(e=>({content:e.message})).then(async result=>{await discord(`/webhooks/${env.DISCORD_CLIENT_ID}/${i.token}/messages/@original`,'PATCH',{...result,allowed_mentions:{parse:[]}})}).catch(()=>{});return;
  }
  if(!ready())return json(res,503,{ok:false,error:'Servidor de acceso sin configurar.'});
  if(url.pathname==='/v1/pair'&&req.method==='POST'){if(pairs.size>=1000)throw new Error('Intentá más tarde.');const id=token(),secret=token();pairs.set(id,{secretHash:hash(secret),expires:Date.now()+300000,user:null});return json(res,200,{ok:true,id,secret,url:env.PUBLIC_URL+'/auth/start?pair='+id});}
  if(url.pathname==='/auth/start'){
   const id=url.searchParams.get('pair'),p=pairs.get(id);if(!p||p.expires<Date.now())throw new Error('Vinculación vencida.');const state=token();states.set(hash(state),{pair:id,expires:Date.now()+300000});const oauth=new URL('https://discord.com/oauth2/authorize');for(const [k,v]of Object.entries({client_id:env.DISCORD_CLIENT_ID,redirect_uri:env.PUBLIC_URL+'/auth/callback',response_type:'code',scope:'identify',state,prompt:'consent'}))oauth.searchParams.set(k,v);res.writeHead(302,{Location:oauth.href,'Set-Cookie':`kyu_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=300`,'Cache-Control':'no-store'});res.end();return;
  }
  if(url.pathname==='/auth/callback'){
   const state=url.searchParams.get('state')||'',cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kyu_oauth='))?.slice(10);const flow=states.get(hash(state));states.delete(hash(state));if(!flow||flow.expires<Date.now()||cookie!==state)throw new Error('Vinculación inválida o vencida.');const p=pairs.get(flow.pair);if(!p||p.expires<Date.now())throw new Error('Vinculación vencida.');
   const r=await transport('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:url.searchParams.get('code')||'',redirect_uri:env.PUBLIC_URL+'/auth/callback'}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Discord rechazó la autorización.');const credentials=await r.json();const discordUser=await discord('/users/@me','GET',undefined,'Bearer '+credentials.access_token);p.user=await identity(discordUser.id);db.users[p.user.id]={username:p.user.username};save();res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Set-Cookie':'kyu_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0'});res.end('Discord vinculado a KyuApp. Podés volver a la aplicación.');return;
  }
  if(url.pathname==='/v1/pair/status'&&req.method==='POST'){const b=JSON.parse(await read(req));const p=pairs.get(b.id);if(!p||p.expires<Date.now()||hash(String(b.secret||''))!==p.secretHash)throw new Error('Vinculación inválida o vencida.');if(!p.user)return json(res,200,{ok:true,ready:false});const bearer=token();sessions.set(hash(bearer),{user:p.user,expires:Date.now()+3600000,lastSeen:0});pairs.delete(b.id);return json(res,200,{ok:true,ready:true,token:bearer,user:p.user});}
  const s=await session(req);
  if(url.pathname==='/v1/me')return json(res,200,{ok:true,user:s.user});
  if(url.pathname==='/v1/heartbeat'&&req.method==='POST'){s.lastSeen=Date.now();return json(res,200,{ok:true,user:s.user});}
  if(url.pathname==='/v1/logout'&&req.method==='POST'){sessions.delete(hash((req.headers.authorization||'').replace(/^Bearer /,'')));return json(res,200,{ok:true});}
  if(url.pathname.startsWith('/v1/friends/')){
   const id=s.user.id;if(url.pathname.endsWith('/list')){const friends=db.friends.filter(f=>f.from===id||f.to===id).map(f=>{const other=f.from===id?f.to:f.from;return {id:other,username:db.users[other]?.username||other,status:f.accepted?'friend':f.to===id?'incoming':'pending'}});return json(res,200,{ok:true,friends});}
   if(req.method!=='POST')throw new Error('Método inválido.');const b=JSON.parse(await read(req));if(!/^\d{17,20}$/.test(b.id)||b.id===id||!db.users[b.id])throw new Error('Ese usuario debe vincular KyuApp primero.');
   if(url.pathname.endsWith('/request')){if(!db.friends.some(f=>(f.from===id&&f.to===b.id)||(f.from===b.id&&f.to===id)))db.friends.push({from:id,to:b.id,accepted:false});}
   else if(url.pathname.endsWith('/accept')){const f=db.friends.find(f=>f.to===id&&f.from===b.id);if(!f)throw new Error('Solicitud inexistente.');f.accepted=true;}
   else if(url.pathname.endsWith('/remove'))db.friends=db.friends.filter(f=>!((f.from===id&&f.to===b.id)||(f.from===b.id&&f.to===id)));else throw new Error('Ruta inválida.');save();return json(res,200,{ok:true});
  }
  json(res,404,{ok:false,error:'Ruta inexistente.'});
 }catch(e){if(!res.headersSent)json(res,403,{ok:false,error:e.message});else res.end();}});
 let timer;return {server,cfg,tick,command,start(port=Number(env.PORT)||3031){server.listen(port,'0.0.0.0');timer=setInterval(()=>tick().catch(()=>{}),30000);timer.unref();return server;},close(){clearInterval(timer);server.close();}};
}
if(require.main===module){const service=createService();service.start();console.log('KyuApp access en localhost. Configurá HTTPS y el endpoint /interactions en Discord.');}
module.exports={createService};
