const { isIP } = require('node:net');

// Client-supplied metadata is not proof of who created a room.
function normalizeHostContext(value) {
  if (!value || typeof value !== 'object') return null;
  const ip = typeof value.reportedIp === 'string' ? value.reportedIp.trim() : '';
  return {
    version: String(value.version || '').slice(0, 24),
    reportedIp: isIP(ip) ? ip : null,
    ownerValidationId: typeof value.ownerValidationId === 'string' ? value.ownerValidationId.slice(0, 120) : null
  };
}

function hostReportField(session, sessions, privateChannel = false) {
  const host = normalizeHostContext(session.hostContext);
  if (!host) return null;
  const owner = sessions.find(s => s.validationId === host.ownerValidationId &&
    s.guildId === session.guildId && s.room === session.room && s.status === 'confirmed' &&
    s.matchedUserId && s.matchedBy === 'auth' && Date.parse(s.confirmedAt) <= Date.now() &&
    Date.now() - Date.parse(s.confirmedAt) < 3 * 60 * 60 * 1000);
  const lines = [
    'Conn/auth del creador: no expuestos por Headless (noPlayer).',
    `IP pública del host (declarada, no verificada): ${host.reportedIp ? (privateChannel ? host.reportedIp : 'oculta; requiere canal privado') : 'no disponible'}`,
    `Versión: ${host.version || 'no disponible'}`
  ];
  if (owner) {
    lines.push(`Owner declarado: <@${owner.matchedUserId}> (identidad confirmada por Discord; no acredita ser el creador).`);
    if (privateChannel) {
      for (const key of ['auth', 'conn', 'ip']) lines.push(`Owner ${key}: ${String(owner[key] || 'no disponible').replace(/[\r\n`]/g, '').slice(0, 120)}`);
    }
  } else lines.push('Owner: sin referencia válida a una confirmación reciente.');
  return { name: 'Contexto del host · datos disponibles', value: lines.join('\n').slice(0, 1024) };
}
module.exports = { normalizeHostContext, hostReportField };
