const crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
function authorize(member,config){
  const roles=Array.isArray(member?.roles)?member.roles:[];
  const has=key=>!!config[key]&&roles.includes(config[key]);
  const proplus=has('proplus'),pro=proplus||has('pro')||has('playerRole')||has('beta');
  const allowed=true,tier=proplus?'proplus':pro?'pro':'basic';
  return {allowed,pro,proplus,tier,profileLimit:proplus?null:pro?2:1,glass:pro,customization:pro,roomTools:proplus,streamer:allowed&&(config.streamerRoles||[]).some(id=>roles.includes(id))};
}
function verifyInteraction(raw,signature,timestamp,key,now=Date.now()){
  if(!/^\d+$/.test(timestamp||'')||Math.abs(now-Number(timestamp)*1000)>300000||!/^[a-f0-9]{128}$/i.test(signature||'')||!/^[a-f0-9]{64}$/i.test(key||''))return false;
  try{return crypto.verify(null,Buffer.concat([Buffer.from(timestamp),raw]),{key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key,'hex')]),format:'der',type:'spki'},Buffer.from(signature,'hex'));}catch{return false;}
}
function duration(value){const match=/^([1-9]\d{0,3})(h|d|w)$/.exec(value||'');if(!match)throw new Error('Tiempo: 12h, 30d o 4w (máximo 365 días).');const ms=Number(match[1])*({h:3600000,d:86400000,w:604800000}[match[2]]);if(ms>365*86400000)throw new Error('Máximo 365 días.');return ms;}
function isAdmin(interaction,guild){try{return interaction.guild_id===guild&&(BigInt(interaction.member?.permissions||0)&(8n|32n))!==0n;}catch{return false;}}
module.exports={hash,token,authorize,verifyInteraction,duration,isAdmin};
