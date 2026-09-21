const crypto = require("crypto");
const { EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig, withGuild } = require("./database");

const identityKeys = ["ip", "conn", "auth"];
const timeOf = row => {
  const value = Date.parse(row.at);
  return Number.isFinite(value) ? value : null;
};

// Remember the FIRST known association, not the most recent person to use it.
// The separate index survives the rolling 5,000-entry report history.
function collectOrigins(records, saved = {}) {
  const origins = Object.fromEntries(identityKeys.map(key => [key, { ...(saved[key] || {}) }]));
  for (const row of records) {
    if (!row?.userId) continue;
    for (const key of identityKeys) {
      if (!row[key]) continue;
      const previous = origins[key][row[key]];
      const candidate = { userId: String(row.userId), name: row.name || null, at: row.at || null };
      if (!previous?.length) { origins[key][row[key]] = [candidate]; continue; }
      const at = timeOf(candidate), first = timeOf(previous[0]);
      // Legacy undated history preserves its insertion order. Dated evidence
      // takes priority over undated data; equal dates remain ambiguous.
      if (at !== null && (first === null || at < first)) origins[key][row[key]] = [candidate];
      else if (at !== null && at === first && !previous.some(p => p.userId === candidate.userId)) origins[key][row[key]] = [...previous, candidate];
    }
  }
  return origins;
}

function evaluate(records, current, savedOrigins = {}) {
  const at = timeOf(current);
  const past = records.filter(row => at === null || timeOf(row) === null || timeOf(row) <= at);
  const origins = collectOrigins(past, savedOrigins);
  const conflicts = {};
  for (const key of identityKeys) {
    conflicts[key] = current[key] ? (origins[key][current[key]] || []).filter(row =>
      row.userId !== String(current.userId) && (at === null || timeOf(row) === null || timeOf(row) <= at)) : [];
  }
  // Changes in one account's own network/auth are not another Discord account.
  let score = conflicts.ip.length ? 50 : 0;
  if (conflicts.conn.length) score = Math.max(score, 75);
  if (conflicts.auth.length) score = Math.max(score, 110);
  if (conflicts.ip.some((row) => conflicts.conn.some((other) => other.userId === row.userId))) score = Math.max(score, 125);
  if (conflicts.ip.some((row) => conflicts.conn.some((other) => other.userId === row.userId) && conflicts.auth.some((other) => other.userId === row.userId))) score = 150;
  return { score, percent: Math.min(100, score), conflicts };
}

function inspection(session) {
  return withGuild(session.guildId, () => {
    const cfg=readConfig();
    cfg.antiDuSecret ||= crypto.randomBytes(32).toString('hex');
    saveConfig(cfg);
    const fingerprint=value=>value?crypto.createHmac('sha256',cfg.antiDuSecret).update(String(value).trim()).digest('hex'):null;
    const current={id:session.id,userId:session.matchedUserId,name:session.playerName,at:session.confirmedAt||new Date().toISOString(),manualAt:session.manualConfirmedAt||session.confirmedAt,automatic:!!session.automatic,ip:fingerprint(session.ip),conn:fingerprint(session.conn),auth:fingerprint(session.auth)};
    const records=(cfg.antiDuHistory||[]).filter(r=>r.id!==session.id);
    const registrations = [];
    const store = require('./officials').readStore();
    const { allowedGuild } = require('./tournamentScope');
    for (const [guildId, users] of Object.entries(store.linksByGuild || {})) {
      if (!allowedGuild(guildId)) continue;
      for (const [userId, entry] of Object.entries(users || {})) for (const link of entry.links || []) {
        registrations.push({ userId, at: link.createdAt || null, ip: fingerprint(link.ip), conn: fingerprint(link.conn), auth: fingerprint(link.auth) });
      }
    }
    const origins = collectOrigins([...registrations, ...records], cfg.antiDuOrigins);
    const previous=records.filter(r=>r.userId===current.userId).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
    const same=!!previous&&['name','auth','conn','ip'].every(k=>!!current[k]&&current[k]===previous[k]);
    return {current,previous,same,origins,result:evaluate(records,current,origins)};
  });
}
function autoValidation(session, now=Date.now()) {
  if(!session.matchedUserId||session.matchedBy!=='auth')return null;
  const review=inspection(session),last=review.previous;
  const age=now-Date.parse(last?.manualAt||(!last?.automatic?last?.at:''));
  if(!review.same||!Number.isFinite(age)||age<0||age>=3*60*60*1000||review.result.score!==0||Object.values(review.result.conflicts).some(a=>a.length))return null;
  return {manualConfirmedAt:last.manualAt||last.at};
}
const sending=new Set();
async function recordValidation(client, session) {
  if (!session?.guildId || !session.matchedUserId || session.status!=='confirmed') return;
  if(sending.has(session.id))return;
  sending.add(session.id);
  try {
  return await withGuild(session.guildId, async () => {
    if(!session.playerId){
      const user=await client.users.fetch(session.matchedUserId).catch(()=>null);
      const identity=await require('./haxoleSupabase').upsertPlayerIdentity({guildId:session.guildId,discordUserId:session.matchedUserId,discordUsername:user?.tag,discordAvatarUrl:user?.displayAvatarURL?.(),haxballName:session.playerName,source:'confirmed-validation'}).catch(()=>({}));
      if(identity.player?.id){session.playerId=identity.player.id;require('./officials').updatePendingSession(session.id,{playerId:session.playerId});}
    }
    const cfg = readConfig();
    const records = cfg.antiDuHistory || [];
    const {current,result,same,origins}=inspection(session);
    const refreshed=readConfig();cfg.antiDuSecret=refreshed.antiDuSecret;
    if(!records.some(row=>row.id===session.id))cfg.antiDuHistory = [...records, current].slice(-5000);
    cfg.antiDuOrigins = collectOrigins([current], origins);
    saveConfig(cfg);
    const fields = ["ip", "conn", "auth"].map((key) => {
      const others = [...new Map(result.conflicts[key].map((row) => [row.userId, row])).values()];
      return others.length ? `⚠️ ${key}: registrado antes con ${others.slice(0, 4).map((row) => `<@${row.userId}>`).join(", ")}` : current[key] ? `✅ ${key}: sin conflicto previo` : `➖ ${key}: sin datos`;
    });
    const embed = new EmbedBuilder().setColor(result.score ? 0xe5a54b : 0x43b581).setTitle("Validación · revisión Anti-DU")
      .setDescription([`-# ${new Date().toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })} | ${String(session.room || "Sala oficial").slice(0, 150)}`, `👤 ${current.name} | <@${current.userId}>`, `${result.score ? "❌" : "✅"} Índice de sospecha de DU: **${result.percent}%**`, ...fields, "✅ user: validación confirmada"].join("\n").slice(0, 4000))
        .setFooter({ text: `Puntaje de reglas: ${result.score}. Indicador heurístico; requiere revisión humana. IP compartida o dinámica no prueba DU.` });
    embed.addFields({name:'Comparación con la última entrada',value:same?'Todos los datos disponibles coinciden.':'Primera entrada, datos incompletos o diferencias con la última entrada.'},{name:'Método',value:session.automatic?'Autovalidación (confirmación manual menor a 3 horas)':'Confirmación por Discord'});
    const {TEST_GUILD}=require('./tournamentScope');
    const targets=[{guild:session.guildId,channel:cfg.validationChannelId}];
    if(session.guildId!==TEST_GUILD)targets.push({guild:TEST_GUILD,channel:withGuild(TEST_GUILD,()=>readConfig().validationChannelId)});
    for(const target of targets){
      if(!target.channel||session.validationReports?.[target.channel])continue;
      const channel=await client.channels.fetch(target.channel);
      if(String(channel?.guildId)!==String(target.guild)||!channel.isTextBased())continue;
      // Host creation details belong only in the separate Host creado webhook.
      await channel.send({embeds:[embed],allowedMentions:{parse:[]}});
      session.validationReports={...session.validationReports,[target.channel]:new Date().toISOString()};
      require('./officials').updatePendingSession(session.id,{validationReports:session.validationReports});
    }
  });
  } finally { sending.delete(session.id); }
}
async function retryReports(client){
 const {TEST_GUILD}=require('./tournamentScope');
 const general=withGuild(TEST_GUILD,()=>readConfig().validationChannelId);
 const sessions=require('./officials').listPendingSessions().filter(s=>s.status==='confirmed'&&s.reportingV2&&Date.now()-Date.parse(s.confirmedAt)<86400000);
 let count=0;
 for(const session of sessions){
   const local=withGuild(session.guildId,()=>readConfig().validationChannelId);
   if(session.playerId&&[local,general].filter(Boolean).every(c=>session.validationReports?.[c]))continue;
   if(++count>20)break;
   await recordValidation(client,session).catch(error=>console.error('[antiDu retry]',error.message));
 }
}
module.exports = { evaluate, collectOrigins, recordValidation, autoValidation, inspection, retryReports };
