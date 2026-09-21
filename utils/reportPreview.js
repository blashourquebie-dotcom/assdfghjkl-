const { escapeMarkdown } = require('discord.js');
const plain = value => escapeMarkdown(String(value || '').replace(/[\r\n]+/g,' ').slice(0,100));
function reportPreview(parsed) {
 const stats = parsed.stats || [];
 const player = row => /^\d+$/.test(row.resolvedUserId || '') ? '<@' + row.resolvedUserId + '>' : plain(row.playerName);
 const clubs = [parsed.localClub, parsed.awayClub];
 const emoji = (club, i) => {
  const token = club?.club?.emoji_full || club?.club?.emoji || club?.row?.emoji_full || stats.find(s => s.clubName === club?.name)?.clubEmoji || club?.raw;
  return /^<a?:\w+:\d+>$|^:[\w&+\-]+:$/.test(token || '') ? token : i ? '🔵' : '🔴';
 };
 const lines = ['**' + emoji(clubs[0],0) + ' ' + plain(clubs[0]?.name || '?') + '  ' + parsed.score.local + ' — ' + parsed.score.away + '  ' + plain(clubs[1]?.name || '?') + ' ' + emoji(clubs[1],1) + '**'];
 if (parsed.df) lines.push('🏳️ **Victoria por DF** · sin estadísticas individuales.');
 else clubs.forEach((club,i) => {
  const rows = stats.filter(row => row.clubName === club?.name);
  lines.push('', '**' + emoji(club,i) + ' ' + plain(club?.name || 'Equipo') + '**', '👥 ' + (rows.map(player).join(' · ') || 'Sin alineación registrada'));
  for (const [field,label] of [['goles','⚽ Goles'],['asistencias','🅰️ Asistencias'],['goles_contra','↩️ En contra']]) {
   const values = rows.filter(row => row[field] > 0);
   if (values.length) lines.push(label + ': ' + values.map(row => player(row) + ' **×' + row[field] + '**').join(', '));
  }
  const keepers = rows.filter(row => row.valla_invicta_segundos > 0);
  if (keepers.length) lines.push('🧤 Valla invicta: ' + keepers.map(row => player(row) + ' **' + Math.floor(row.valla_invicta_segundos / 60) + ':' + String(row.valla_invicta_segundos % 60).padStart(2,'0') + '**').join(', '));
 });
 for (const [field,label] of [['es_mvp','⭐ MVP'],['es_destacado','✨ Destacados']]) {
  const rows = stats.filter(row => row[field]);
  if (rows.length) lines.push('', '**' + label + ':** ' + rows.map(player).join(' · '));
 }
 if (parsed.recUrl) {
  try { const url = new URL(parsed.recUrl); if (url.protocol === 'https:') lines.push('', '[▶ Ver replay](<' + url.href + '>)'); } catch { /* Invalid URLs are not links. */ }
 }
 if (parsed.warnings?.length) lines.push('', '⚠️ **Revisar:**', ...parsed.warnings.map(w => '• ' + plain(w)));
 return lines.join('\n');
}
module.exports = { reportPreview };
