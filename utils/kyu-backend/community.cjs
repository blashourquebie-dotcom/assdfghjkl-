const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pink=0xffadd0;
function banner(payload,kind,env){
 if(!env.KYU_BANNER_DIR)return payload;
 const file=path.join(env.KYU_BANNER_DIR,kind+'.png');
 let bytes;try{bytes=fs.readFileSync(file);}catch(e){if(e.code==='ENOENT')return payload;throw e;}
 if(bytes.length>8*1024*1024||bytes.length<8||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('El banner '+kind+'.png debe ser PNG de hasta 8 MB.');
 const name=kind+'.png';payload._files=[{name,bytes}];payload.attachments=[{id:0,filename:name}];
 if(payload.embeds)payload.embeds[0].image={url:'attachment://'+name};
 else payload.components[0].components.unshift({type:12,items:[{media:{url:'attachment://'+name},description:kind+' · KyuApp'}]});
 return payload;
}
function createCommunity({db,save,discord,cfg,env}){
 const option=(i,name)=>i.data?.options?.find(o=>o.name===name)?.value;
 const panel=(color,sections)=>({flags:32768,components:[{type:17,accent_color:color,components:sections.flatMap((content,index)=>index?[{type:14,divider:true},{type:10,content}]:[{type:10,content}])}]});
 const betaPanel=c=>{const count=Object.values(c.entries).filter(e=>e==='joined').length,pending=Object.values(c.entries).filter(e=>e==='pending').length;return {flags:32768,components:[{type:17,accent_color:0x6f8cff,components:[
  {type:10,content:'# 🧪 Beta'},
  {type:14,divider:true},
  {type:10,content:'## 🚀 INSCRIPCIONES ABIERTAS PARA BETATESTER\n👤 **'+count+'**/'+c.limit+(pending?' · '+pending+' pendiente'+(pending===1?'':'s'):'')+'\n\nProbá las próximas versiones de KyuApp y ayudanos a detectar errores.'},
  {type:14,divider:true},
  {type:1,components:[{type:2,style:1,label:count+pending>=c.limit?'Cupo completo':'Inscribirme',custom_id:'kyu:beta:'+c.id}]}
 ]}]};};
 // One queue serializes the only capacity writer. Reservations are persisted
 // before assigning roles, so a restart cannot offer the last slot twice.
 let tail=Promise.resolve();
 function serial(fn){const task=tail.then(fn);tail=task.catch(()=>{});return task;}
 async function refresh(c){try{await discord(`/channels/${c.channel}/messages/${c.message}`,'PATCH',betaPanel(c));c.dirty=false;save();}catch{c.dirty=true;save();}}
 async function command(i){
  const name=i.data?.name,user=i.member.user.id;
  if(i.type===3&&String(i.data?.custom_id||'').startsWith('kyu:beta:'))return serial(async()=>{
   const c=db.beta;if(!c||i.data.custom_id!=='kyu:beta:'+c.id||i.channel_id!==c.channel||i.message?.id!==c.message)throw Error('Esta inscripción ya no está activa.');
   if(i.member.user.bot)throw Error('La inscripción es para personas, no bots.');
   if(c.entries[user]==='joined'){if(c.dirty)await refresh(c);return {content:'Ya estás inscripto.'};}
   if(!c.entries[user]&&Object.keys(c.entries).length>=c.limit)return {content:'Se completó el cupo.'};
   c.entries[user]='pending';save();
   try{await discord(`/guilds/${cfg.guild}/members/${user}/roles/${c.role}`,'PUT');}
   catch(e){if(e.status===403){delete c.entries[user];save();}await refresh(c);throw Error(e.status===403?'No pude asignar el rol. Revisá los permisos y la jerarquía del bot.':'Discord no confirmó la inscripción. Tu lugar queda reservado; volvé a tocar el botón para reintentar.');}
   c.entries[user]='joined';save();await refresh(c);return {content:'Ya sos parte de los betatesters.'};
  });
  if(i.type!==2)return null;
  if(name==='introduccion'){
   const payload=panel(0x6f8cff,[
    '# 📚 Introducción a 2J x KyuApp\nDeveloped by **@m05e.**',
    '## 🆕 KYUAPP\n⚡ **0 delay** · delay personalizado\n🎨 **100% personalizado**\n🧩 **100% optimizado** · FPS ilimitados y resolución personalizada\n✨ Imágenes de avatar · PNGs y GIFs\n👤 Salas multi popeo',
    '## ⚡ 2J APP (LITE)\n⚡ **0 delay** · delay personalizado\n🧩 **100% optimizado** · FPS ilimitados y resolución personalizada\n🥔 Potato graphics'
   ]);
   await discord('/channels/'+i.channel_id+'/messages','POST',banner(payload,'kyuapp',env));
   return {content:'Introducción publicada.'};
  }
  if(name==='introduccion_legacy'){
   const intro={embeds:[{color:pink,description:'# 📚 Introducción a 2J x KyuApp\nDeveloped by **\`@m05e.\`**\n\n## 🆕 KYUAPP\n- \`⚡\` **0 delay** · delay personalizado\n- \`🎨\` **100% personalizado**\n- \`🧩\` **100% optimizado** · FPS ilimitados y resolución personalizada\n- \`✨\` Imágenes de avatar · PNGs y GIFs\n- \`👤\` Salas multi popeo\n\n## ⚡ 2J APP (LITE)\n- \`⚡\` **0 delay** · delay personalizado\n- \`🧩\` **100% optimizado** · FPS ilimitados y resolución personalizada\n- \`🥔\` Potato graphics',footer:{text:'KyuApp · 2J App Lite'}}],allowed_mentions:{parse:[]}};
   await discord('/channels/'+i.channel_id+'/messages','POST',banner(intro,'kyuapp',env));
   return {content:'Introducción publicada.'};
  }
  if(name==='introduccion_legacy'){
   await discord(`/channels/${i.channel_id}/messages`,'POST',banner({embeds:[{title:'KyuApp',color:pink,description:'Tu lugar para jugar HaxBall.\n\nPersonalizá la cancha, la cámara, los marcadores y tu avatar. Guardá tus ajustes en perfiles y conectate con amigos desde Comunidad.\n\nPara entrar necesitás vincular Discord y tener el rol de jugador Kyu. Si necesitás acceso o ayuda, abrí un ticket.',footer:{text:'marce · m05e'},url:'https://github.com/MarceeeJs'}],allowed_mentions:{parse:[]}},'kyuapp',env));return {content:'Introducción publicada.'};
  }
  if(name==='planes'){
   const old=db.prices||{},keys=['pro_ars','pro_uyu','pro_boosts','proplus_ars','proplus_uyu','proplus_boosts'],prices={pro_uyu:100,pro_boosts:1,proplus_ars:5500,proplus_uyu:150,proplus_boosts:2,...old};
   for(const key of keys){const value=option(i,key);if(value!==undefined){if(!Number.isSafeInteger(value)||value<1||value>10000000)throw Error('Precio o cantidad inválida.');prices[key]=value;}}
   if(!prices.pro_ars)throw Error('Indicá pro_ars la primera vez: falta confirmar el precio de Pro.');
   const payload=panel(0x6f8cff,[
    '# 💸 Planes',
    '## 🪙 PLAN PRO\n💰 **$'+prices.pro_ars+' ARS** // **'+prices.pro_uyu+' UYU**\n🚀 **'+prices.pro_boosts+' boost'+(prices.pro_boosts===1?'':'s')+'** × 1 mes',
    '## 💎 PLAN PRO+ (PLUS)\n💰 **$'+prices.proplus_ars+' ARS** // **'+prices.proplus_uyu+' UYU**\n🚀 **'+prices.proplus_boosts+' boost'+(prices.proplus_boosts===1?'':'s')+'** × 1 mes',
    '> Abrí un ticket para consultar o adquirir un plan.'
   ]);
   await discord('/channels/'+i.channel_id+'/messages','POST',banner(payload,'planes',env));
   db.prices=prices;save();return {content:'Planes publicados. Precios guardados.'};
  }
  if(name==='planes_component_legacy'){
   const old=db.prices||{},keys=['pro_ars','pro_uyu','pro_boosts','proplus_ars','proplus_uyu','proplus_boosts'],prices={pro_uyu:100,pro_boosts:1,proplus_ars:5500,proplus_uyu:150,proplus_boosts:2,...old};
   for(const key of keys){const value=option(i,key);if(value!==undefined){if(!Number.isSafeInteger(value)||value<1||value>10000000)throw Error('Precio o cantidad inválida.');prices[key]=value;}}
   if(!prices.pro_ars)throw Error('Indicá pro_ars la primera vez: falta confirmar el precio de Pro.');
   const planText='# 💸 Planes\n\n## 🪙 PLAN PRO\n- \`💰\` **$'+prices.pro_ars+' ARS** // **'+prices.pro_uyu+' UYU**\n- \`🚀\` **'+prices.pro_boosts+' boost'+(prices.pro_boosts===1?'':'s')+'** × 1 mes\n\n## 💎 PLAN PRO+ (PLUS)\n- \`💰\` **$'+prices.proplus_ars+' ARS** // **'+prices.proplus_uyu+' UYU**\n- \`🚀\` **'+prices.proplus_boosts+' boost'+(prices.proplus_boosts===1?'':'s')+'** × 1 mes\n\n> Abrí un ticket para consultar o adquirir un plan.';
   await discord('/channels/'+i.channel_id+'/messages','POST',banner({embeds:[{color:pink,description:planText,footer:{text:'KyuApp · precios configurados por administración'}}],allowed_mentions:{parse:[]}},'planes',env));
   db.prices=prices;save();return {content:'Planes publicados. Precios guardados.'};
  }
  if(name==='planes_legacy'){
   const old=db.prices||{},keys=['pro_ars','pro_uyu','pro_boosts','proplus_ars','proplus_uyu','proplus_boosts'],prices={pro_uyu:100,pro_boosts:1,proplus_ars:5500,proplus_uyu:150,proplus_boosts:2,...old};
   for(const key of keys){const value=option(i,key);if(value!==undefined){if(!Number.isSafeInteger(value)||value<1||value>10000000)throw Error('Precio o cantidad inválida.');prices[key]=value;}}
   if(!prices.pro_ars)throw Error('Indicá pro_ars la primera vez: falta confirmar el precio de Pro.');
   const payload=banner({embeds:[{title:'Planes · KyuApp',color:pink,description:'Abrí un ticket antes de adquirir un plan.',fields:[{name:'Pro',value:`$${prices.pro_ars} ARS · ${prices.pro_uyu} UYU\n${prices.pro_boosts} boost(s) · 1 mes por mes`},{name:'Pro+',value:`$${prices.proplus_ars} ARS · ${prices.proplus_uyu} UYU\n${prices.proplus_boosts} boost(s) · 1 mes por mes`}],footer:{text:'Transferencia: actualizaciones durante 3 meses. Después conservás la última versión descargada.'}}],allowed_mentions:{parse:[]}},'planes',env);
   await discord(`/channels/${i.channel_id}/messages`,'POST',payload);db.prices=prices;save();return {content:'Planes publicados. Precios guardados.'};
  }
  if(name==='prolist'){
   const filter=option(i,'plan');if(filter&&!['pro','proplus','playerRole','beta','ver'].includes(filter))throw Error('Plan inválido.');
   const rows=Object.entries(db.plans).filter(([,p])=>p.expires>Date.now()&&(!filter||p.plan===filter));
   const page=option(i,'pagina')||1,pages=Math.max(1,Math.ceil(rows.length/15));if(!Number.isInteger(page)||page<1||page>pages)throw Error('Página fuera de rango. Hay '+pages+' página(s).');
   rows.sort((a,b)=>a[1].expires-b[1].expires);return {embeds:[{title:'Planes registrados · KyuApp',color:pink,description:rows.slice((page-1)*15,page*15).map(([id,p])=>`<@${id}> · ${({proplus:'Pro+',pro:'Pro',playerRole:'Kyu',beta:'Beta',ver:'Ver'}[p.plan]||p.plan)} · vence <t:${Math.floor(p.expires/1000)}:f>`).join('\n')||'Sin planes activos registrados.',footer:{text:`Página ${page}/${pages} · No incluye roles asignados manualmente.`}}],allowed_mentions:{parse:[]}};
  }
  if(name==='betatester')return serial(async()=>{
   const limit=option(i,'cantidad');if(!Number.isInteger(limit)||limit<1||limit>10000)throw Error('El cupo debe estar entre 1 y 10000.');
   if(db.beta)throw Error('Ya existe una inscripción. Usá /betaestado o /betacerrar antes de abrir otra.');
   const roles=await discord(`/guilds/${cfg.guild}/roles`),explicit=option(i,'rol'),matches=roles.filter(r=>explicit?r.id===explicit:r.name.trim().toLowerCase()==='beta');
   if(matches.length!==1||matches[0].managed||[cfg.guild,cfg.playerRole,cfg.pro,cfg.proplus,env.KYU_STAFF_ROLE_ID].includes(matches[0].id)||BigInt(matches[0].permissions||'0')!==0n)throw Error('Elegí un rol beta único, sin permisos, distinto de jugador, Pro y staff.');
   const c={id:crypto.randomBytes(8).toString('hex'),role:matches[0].id,limit,entries:{},channel:i.channel_id,message:null};
   const posted=await discord(`/channels/${c.channel}/messages`,'POST',banner(betaPanel(c),'betatesters',env));
   if(!posted?.id)throw Error('Discord no confirmó el panel.');c.message=posted.id;db.beta=c;save();return {content:'Inscripción abierta. El bot debe estar por encima del rol beta.'};
  });
  if(name==='betaestado'){const c=db.beta;return {content:c?`Inscripción: <#${c.channel}> · ${Object.values(c.entries).filter(e=>e==='joined').length}/${c.limit} confirmadas · ${Object.values(c.entries).filter(e=>e==='pending').length} pendientes.`:'No hay inscripción abierta.'};}
  if(name==='betacerrar')return serial(async()=>{const c=db.beta;if(!c)throw Error('No hay inscripción abierta.');const payload=betaPanel(c);const button=payload.components[0].components.find(x=>x.type===1).components[0];button.disabled=true;button.label='Inscripción cerrada';await discord(`/channels/${c.channel}/messages/${c.message}`,'PATCH',payload);db.beta=null;save();return {content:'Inscripción cerrada. Se conservan los roles ya asignados.'};});
  return null;
 }
 return {command,tick:()=>serial(async()=>{if(db.beta?.dirty)await refresh(db.beta);})};
}
module.exports={createCommunity,banner};
