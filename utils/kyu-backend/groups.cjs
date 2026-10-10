const {randomUUID}=require('node:crypto');
const MODES={big:3,x3:3,x4:4,x5:5,x7:7,rsx4:4};
const MATCH_STEP=50,MATCH_STEP_MS=30000;
function avatar(id,value){return /^https:\/\/cdn\.discordapp\.com\/(avatars|embed\/avatars)\//.test(value||'')?value:'https://cdn.discordapp.com/embed/avatars/0.png';}
function createGroups(db,save,now=Date.now){
 db.groups=db.groups||{};
 db.matchmaking=db.matchmaking||{};
 const groups=()=>Object.values(db.groups);
 const current=id=>groups().find(g=>g.members.includes(id));
 const friends=(a,b)=>db.friends.some(f=>f.accepted&&((f.from===a&&f.to===b)||(f.from===b&&f.to===a)));
 function member(id){const pr=db.playerPR?.[id];return {id,tier:db.users[id]?.tier,username:db.users[id]?.username||id,avatar:avatar(id,db.users[id]?.avatar),pr:Number.isFinite(pr)&&pr>=0?pr:0};}
 function clearSearch(g){if(!g)return;const entry=db.matchmaking[g.id];if(entry?.matched){const rival=db.matchmaking[entry.matched];if(rival){delete rival.matched;delete rival.mode;delete rival.matchedAt;}}delete db.matchmaking[g.id];}
 function search(g){const entry=db.matchmaking[g.id];if(!entry)return null;const elapsed=Math.max(0,now()-entry.startedAt),range=MATCH_STEP*(1+Math.floor(elapsed/MATCH_STEP_MS));return {active:true,startedAt:entry.startedAt,modes:entry.modes,range,minimum:Math.max(0,...entry.modes.map(mode=>MODES[mode]-g.members.length)),matched:!!entry.matched,rival:entry.matched||null,mode:entry.mode||null};}
 function view(g){if(!g)return null;const members=g.members.map(member);return {id:g.id,leader:g.leader,hoster:g.members.includes(g.hoster)?g.hoster:g.leader,modes:g.modes||[],modeSizes:MODES,recommendedHoster:null,pr:Math.round(members.reduce((n,m)=>n+m.pr,0)/Math.max(1,members.length)),room:g.room&&g.room.expires>now()?g.room:null,search:search(g),members};}
 function tryMatch(g){const own=db.matchmaking[g.id];if(!own||own.matched)return;const ownView=view(g);for(const rival of groups()){if(rival.id===g.id)continue;const other=db.matchmaking[rival.id],rivalView=view(rival);if(!other||other.matched)continue;const mode=own.modes.find(m=>other.modes.includes(m)&&g.members.length>=MODES[m]&&rival.members.length>=MODES[m]);if(!mode)continue;const ownRange=search(g).range,otherRange=search(rival).range,diff=Math.abs(ownView.pr-rivalView.pr);if(diff>ownRange||diff>otherRange)continue;own.matched=rival.id;own.mode=mode;own.matchedAt=now();other.matched=g.id;other.mode=mode;other.matchedAt=now();break;}}
 function run(id,action,data={}){
  if(action==='state'){const g=current(id);if(g)tryMatch(g);return {canInvite:g?.leader===id,self:member(id),group:view(g),invitations:groups().filter(g=>g.invites[id]>now()&&friends(g.leader,id)).map(g=>({id:g.id,leader:g.leader,username:db.users[g.leader]?.username||g.leader}))};}
  let group=current(id);
  if(action==='create'){if(group)throw Error('Ya estás en un grupo.');const key=randomUUID();db.groups[key]={id:key,leader:id,hoster:id,modes:[],members:[id],invites:{}};}
  else if(action==='invite'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede invitar.');
   if(typeof data.id!=='string'||data.id===id||!db.users[data.id]||!friends(id,data.id))throw Error('Elegí un amigo con solicitud aceptada.');
   if(current(data.id))throw Error('Tu amigo ya está en un grupo.');
   for(const [key,expires]of Object.entries(group.invites))if(expires<=now())delete group.invites[key];
   if(group.members.length>=7||Object.keys(group.invites).length>=20)throw Error('Grupo completo: máximo 7 integrantes.');
   group.invites[data.id]=now()+300000;
  }else if(action==='join'||action==='decline'){
   const invited=groups().find(g=>g.id===data.groupId);
   if(!invited||!(invited.invites[id]>now())||!friends(invited.leader,id))throw Error('Invitación vencida o inexistente.');
   if(action==='join'){if(group)throw Error('Salí de tu grupo primero.');if(invited.members.length>=7)throw Error('Grupo completo: máximo 7 integrantes.');invited.members.push(id);}
   delete invited.invites[id];
  }else if(action==='room'){
   if(!group||(group.leader!==id&&group.hoster!==id))throw Error('Solo el líder o el hoster pueden compartir una sala.');
   if(data.url===null)delete group.room;else{const url=roomUrl(data.url),room={url,by:id,event:randomUUID(),expires:now()+120000};group.room=room;const rivalId=db.matchmaking[group.id]?.matched,rival=rivalId&&db.groups[rivalId];if(rival)rival.room={...room,event:randomUUID()};}
  }else if(action==='leader'||action==='hoster'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede cambiar los roles.');
   if(typeof data.id!=='string'||!group.members.includes(data.id))throw Error('Miembro inválido.');
   if(action==='leader'){group.invites={};group.hoster=group.hoster||group.leader;}
   group[action]=data.id;delete group.room;clearSearch(group);
  }else if(action==='modes'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede elegir modalidades.');
   if(!Array.isArray(data.modes)||data.modes.length>2||new Set(data.modes).size!==data.modes.length||data.modes.some(m=>!Object.hasOwn(MODES,m)))throw Error('Elegí como máximo dos modalidades válidas.');
   group.modes=data.modes.slice();
  }else if(action==='search'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede iniciar la búsqueda.');
   if(!group.modes?.length)throw Error('Elegí una o dos modalidades.');
   db.matchmaking[group.id]={startedAt:now(),modes:group.modes.slice()};tryMatch(group);
  }else if(action==='cancel-search'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede cancelar la búsqueda.');clearSearch(group);
  }else if(action==='remove'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede quitar miembros.');
   if(typeof data.id!=='string'||data.id===id||!group.members.includes(data.id))throw Error('Miembro inválido.');
   group.members=group.members.filter(member=>member!==data.id);delete group.invites[data.id];
   if(group.hoster===data.id){group.hoster=group.leader;delete group.room;}clearSearch(group);
  }else if(action==='leave'){
   if(!group)throw Error('No estás en un grupo.');group.members=group.members.filter(member=>member!==id);
   if(!group.members.length){clearSearch(group);delete db.groups[group.id];}else if(group.leader===id){group.leader=group.members[0];group.invites={};delete group.room;clearSearch(group);}
   if(group.hoster===id){group.hoster=group.leader;delete group.room;}
  }else throw Error('Acción de grupo inválida.');
  save();return run(id,'state');
 }
 return {run};
}
function roomUrl(raw){
 if(typeof raw!=='string'||raw.length>512)throw Error('Enlace inválido.');
 let u;try{u=new URL(raw);}catch{throw Error('Enlace inválido.');}
 const code=u.searchParams.get('c');
 if(u.protocol!=='https:'||!['www.haxball.com','haxball.com'].includes(u.hostname)||u.port||u.username||u.password||u.pathname!=='/play'||!/^[-_a-zA-Z0-9]{6,128}$/.test(code||''))throw Error('Enlace inválido.');
 return 'https://www.haxball.com/play?c='+encodeURIComponent(code);
}
module.exports={createGroups,roomUrl,MODES,avatar};
