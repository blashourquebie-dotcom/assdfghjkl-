const {randomUUID}=require('node:crypto');
const MODES={big:3,x3:3,x4:4,x5:5,x7:7,rsx4:4},STEP=50,STEP_MS=30000;
function avatar(value){return /^https:\/\/cdn\.discordapp\.com\/(avatars|embed\/avatars)\//.test(value||'')?value:'https://cdn.discordapp.com/embed/avatars/0.png';}
function createGroups(db,save,now=Date.now){
 db.groups=db.groups||{};db.matchmaking=db.matchmaking||{};
 const groups=()=>Object.values(db.groups),current=id=>groups().find(g=>g.members.includes(id)),friends=(a,b)=>db.friends.some(f=>f.accepted&&((f.from===a&&f.to===b)||(f.from===b&&f.to===a)));
 const member=id=>({id,username:db.users[id]?.username||id,avatar:avatar(db.users[id]?.avatar),pr:Number.isFinite(db.playerPR?.[id])&&db.playerPR[id]>=0?db.playerPR[id]:0});
 function clear(g){if(!g)return;const e=db.matchmaking[g.id],other=e?.matched&&db.matchmaking[e.matched];if(other){delete other.matched;delete other.mode;}delete db.matchmaking[g.id];}
 function search(g){const e=db.matchmaking[g.id];if(!e)return null;return {active:true,startedAt:e.startedAt,modes:e.modes,range:STEP*(1+Math.floor(Math.max(0,now()-e.startedAt)/STEP_MS)),minimum:Math.max(0,...e.modes.map(m=>MODES[m]-g.members.length)),matched:!!e.matched,rival:e.matched||null,mode:e.mode||null};}
 function view(g){if(!g)return null;const members=g.members.map(member);return {id:g.id,leader:g.leader,hoster:g.members.includes(g.hoster)?g.hoster:g.leader,modes:g.modes||[],modeSizes:MODES,pr:Math.round(members.reduce((n,m)=>n+m.pr,0)/Math.max(1,members.length)),room:g.room&&g.room.expires>now()?g.room:null,search:search(g),members};}
 function match(g){const own=db.matchmaking[g.id];if(!own||own.matched)return;const me=view(g);for(const rival of groups()){const other=db.matchmaking[rival.id];if(rival.id===g.id||!other||other.matched)continue;const mode=own.modes.find(m=>other.modes.includes(m)&&g.members.length>=MODES[m]&&rival.members.length>=MODES[m]);if(!mode)continue;const rv=view(rival),difference=Math.abs(me.pr-rv.pr);if(difference>search(g).range||difference>search(rival).range)continue;own.matched=rival.id;own.mode=mode;other.matched=g.id;other.mode=mode;break;}}
 function run(id,action,data={}){
  if(action==='state'){const g=current(id);if(g)match(g);return {canInvite:g?.leader===id,self:member(id),group:view(g),invitations:groups().filter(g=>g.invites[id]>now()&&friends(g.leader,id)).map(g=>({id:g.id,leader:g.leader,username:db.users[g.leader]?.username||g.leader}))};}
  let g=current(id);
  if(action==='create'){if(g)throw Error('Ya estás en un grupo.');const key=randomUUID();db.groups[key]={id:key,leader:id,hoster:id,modes:[],members:[id],invites:{}};}
  else if(action==='invite'){if(!g||g.leader!==id)throw Error('Solo el líder puede invitar.');if(typeof data.id!=='string'||data.id===id||!db.users[data.id]||!friends(id,data.id))throw Error('Elegí un amigo con solicitud aceptada.');if(current(data.id))throw Error('Tu amigo ya está en un grupo.');if(g.members.length>=7)throw Error('Grupo completo: máximo 7 integrantes.');g.invites[data.id]=now()+300000;}
  else if(action==='join'||action==='decline'){const invited=groups().find(x=>x.id===data.groupId);if(!invited||!(invited.invites[id]>now())||!friends(invited.leader,id))throw Error('Invitación vencida o inexistente.');if(action==='join'){if(g)throw Error('Salí de tu grupo primero.');if(invited.members.length>=7)throw Error('Grupo completo: máximo 7 integrantes.');invited.members.push(id);}delete invited.invites[id];}
  else if(action==='room'){if(!g||(g.leader!==id&&g.hoster!==id))throw Error('Solo el líder o el hoster pueden compartir una sala.');if(data.url===null)delete g.room;else{const room={url:roomUrl(data.url),by:id,event:randomUUID(),expires:now()+120000};g.room=room;const rival=db.matchmaking[g.id]?.matched&&db.groups[db.matchmaking[g.id].matched];if(rival)rival.room={...room,event:randomUUID()};}}
  else if(action==='leader'||action==='hoster'){if(!g||g.leader!==id||!g.members.includes(data.id))throw Error('Solo el líder puede cambiar los roles.');g[action]=data.id;delete g.room;clear(g);}
  else if(action==='modes'){if(!g||g.leader!==id||!Array.isArray(data.modes)||data.modes.length>2||new Set(data.modes).size!==data.modes.length||data.modes.some(m=>!Object.hasOwn(MODES,m)))throw Error('Elegí como máximo dos modalidades válidas.');g.modes=data.modes.slice();}
  else if(action==='search'){if(!g||g.leader!==id)throw Error('Solo el líder puede iniciar la búsqueda.');if(!g.modes?.length)throw Error('Elegí una o dos modalidades.');db.matchmaking[g.id]={startedAt:now(),modes:g.modes.slice()};match(g);}
  else if(action==='cancel-search'){if(!g||g.leader!==id)throw Error('Solo el líder puede cancelar la búsqueda.');clear(g);}
  else if(action==='remove'){if(!g||g.leader!==id||data.id===id||!g.members.includes(data.id))throw Error('Miembro inválido.');g.members=g.members.filter(x=>x!==data.id);delete g.invites[data.id];if(g.hoster===data.id)g.hoster=g.leader;clear(g);}
  else if(action==='leave'){if(!g)throw Error('No estás en un grupo.');g.members=g.members.filter(x=>x!==id);if(!g.members.length){clear(g);delete db.groups[g.id];}else if(g.leader===id){g.leader=g.members[0];g.hoster=g.leader;delete g.room;clear(g);}}
  else throw Error('Acción de grupo inválida.');save();return run(id,'state');
 }
 return {run};
}
function roomUrl(raw){if(typeof raw!=='string'||raw.length>512)throw Error('Enlace inválido.');let u;try{u=new URL(raw);}catch{throw Error('Enlace inválido.');}const code=u.searchParams.get('c');if(u.protocol!=='https:'||!['www.haxball.com','haxball.com'].includes(u.hostname)||u.port||u.username||u.password||u.pathname!=='/play'||!/^[-_a-zA-Z0-9]{6,128}$/.test(code||''))throw Error('Enlace inválido.');return 'https://www.haxball.com/play?c='+encodeURIComponent(code);}
module.exports={createGroups,roomUrl,MODES};
