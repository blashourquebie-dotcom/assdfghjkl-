const { isIP } = require('node:net');

function normalizeIp(value) {
  const ip = typeof value === 'string' ? value.trim() : '';
  if (!isIP(ip)) return null;
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  if (canonical.startsWith('::ffff:')) {
    const parts = canonical.slice(7).split(':');
    if (parts.length === 2) return parts.flatMap(p => [parseInt(p, 16) >> 8, parseInt(p, 16) & 255]).join('.');
  }
  return canonical;
}

// Some stored conns encode an IP as hexadecimal text. Opaque conns stay opaque.
function ipFromStoredConn(conn) {
  if (typeof conn !== 'string' || conn.length > 128 || !/^(?:[0-9a-f]{2})+$/i.test(conn)) return null;
  return normalizeIp(Buffer.from(conn, 'hex').toString('utf8'));
}

function findHostNetworkMatches(hostIp, store, allowedGuild) {
  const ip = normalizeIp(hostIp), matches = new Map();
  if (!ip) return [];
  function inspect(userId, row, source) {
    if (!/^\d{17,20}$/.test(String(userId))) return;
    const byIp = normalizeIp(row.ip) === ip;
    const byConnIp = ipFromStoredConn(row.conn) === ip;
    if (!byIp && !byConnIp) return;
    const found = matches.get(userId) || { userId, byIp: false, byConnIp: false, conns: [], sources: [] };
    found.byIp ||= byIp;
    found.byConnIp ||= byConnIp;
    if (byConnIp && !found.conns.includes(row.conn)) found.conns.push(row.conn);
    if (!found.sources.includes(source)) found.sources.push(source);
    matches.set(userId, found);
  }
  for (const [guild, users] of Object.entries(store.linksByGuild || {})) {
    if (!allowedGuild(guild)) continue;
    for (const [userId, entry] of Object.entries(users || {})) {
      for (const row of entry.links || []) inspect(userId, row, 'vinculación guardada');
    }
  }
  for (const session of Object.values(store.pendingSessions || {})) {
    if (!allowedGuild(session.guildId) || session.status !== 'confirmed' || !session.confirmedAt) continue;
    inspect(session.matchedUserId, session, 'entrada confirmada');
  }
  return [...matches.values()].sort((a, b) => Number(b.byIp) + Number(b.byConnIp) - Number(a.byIp) - Number(a.byConnIp) || a.userId.localeCompare(b.userId));
}

function hostMatchField(ip, store, allowedGuild, privateChannel) {
  if (!privateChannel) return { name: 'Coincidencias del hoster', value: 'Ocultas: configurá el canal como privado para consultar los datos de conexión.' };
  if (!normalizeIp(ip)) return { name: 'Coincidencias del hoster', value: 'No se pudo obtener la IP pública del host.' };
  const matches = findHostNetworkMatches(ip, store, allowedGuild);
  const lines = matches.slice(0, 5).map(row => {
    const reasons = [row.byIp && 'IP guardada', row.byConnIp && 'IP contenida en conn guardada'].filter(Boolean);
    return `<@${row.userId}> · ${reasons.join(' + ')}${row.conns[0] ? `\nConn registrada: ${row.conns[0].slice(0, 90)}` : ''}`;
  });
  if (matches.length > 5) lines.push(`Y ${matches.length - 5} coincidencias más.`);
  lines.push(matches.length ? 'Posibles coincidencias de red; no prueban quién creó la sala. IP y conn derivada no son dos pruebas independientes.' : 'Sin coincidencias en las vinculaciones o entradas confirmadas de las ligas.');
  return { name: 'Coincidencias del hoster', value: lines.join('\n').slice(0, 1024) };
}

module.exports = { normalizeIp, ipFromStoredConn, findHostNetworkMatches, hostMatchField };
