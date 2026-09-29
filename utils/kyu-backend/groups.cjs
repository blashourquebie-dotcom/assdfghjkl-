const {randomUUID}=require('node:crypto');
function createGroups(db,save,now=Date.now){
 db.groups=db.groups||{};
 const groups=()=>Object.values(db.groups);
 const current=id=>groups().find(g=>g.members.includes(id));
 const friends=(a,b)=>db.friends.some(f=>f.accepted&&((f.from===a&&f.to===b)||(f.from===b&&f.to===a)));
 function view(g){return g?{id:g.id,leader:g.leader,room:g.room&&g.room.expires>now()?g.room:null,members:g.members.map(id=>({id,username:db.users[id]?.username||id}))}:null;}
 function run(id,action,data={}){
  if(action==='state')return {canInvite:current(id)?.leader===id,group:view(current(id)),invitations:groups().filter(g=>g.invites[id]>now()&&friends(g.leader,id)).map(g=>({id:g.id,leader:g.leader,username:db.users[g.leader]?.username||g.leader}))};
  let group=current(id);
  if(action==='create'){if(group)throw Error('Ya estás en un grupo.');const key=randomUUID();db.groups[key]={id:key,leader:id,members:[id],invites:{}};}
  else if(action==='invite'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede invitar.');
   if(typeof data.id!=='string'||data.id===id||!db.users[data.id]||!friends(id,data.id))throw Error('Elegí un amigo con solicitud aceptada.');
   if(current(data.id))throw Error('Tu amigo ya está en un grupo.');
   for(const [key,expires]of Object.entries(group.invites))if(expires<=now())delete group.invites[key];
   if(group.members.length>=8||Object.keys(group.invites).length>=20)throw Error('Grupo o invitaciones completos.');
   group.invites[data.id]=now()+300000;
  }else if(action==='join'||action==='decline'){
   const invited=groups().find(g=>g.id===data.groupId);
   if(!invited||!(invited.invites[id]>now())||!friends(invited.leader,id))throw Error('Invitación vencida o inexistente.');
   if(action==='join'){if(group)throw Error('Salí de tu grupo primero.');if(invited.members.length>=8)throw Error('Grupo completo.');invited.members.push(id);}
   delete invited.invites[id];
  }else if(action==='room'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede compartir una sala.');
   if(data.url===null)delete group.room;else{const url=roomUrl(data.url);group.room={url,event:randomUUID(),expires:now()+120000};}
  }else if(action==='remove'){
   if(!group||group.leader!==id)throw Error('Solo el líder puede quitar miembros.');
   if(typeof data.id!=='string'||data.id===id||!group.members.includes(data.id))throw Error('Miembro inválido.');
   group.members=group.members.filter(member=>member!==data.id);delete group.invites[data.id];
  }else if(action==='leave'){
   if(!group)throw Error('No estás en un grupo.');group.members=group.members.filter(member=>member!==id);
   if(!group.members.length)delete db.groups[group.id];else if(group.leader===id){group.leader=group.members[0];group.invites={};delete group.room;}
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
module.exports={createGroups,roomUrl};
