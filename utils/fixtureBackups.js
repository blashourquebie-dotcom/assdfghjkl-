const api = require('./supabaseClient');
const ADMIN = '1396189311455727636';

function createFixtureBackupWorker(client, db = api) {
  let running = false;
  return async function processFixtureBackups() {
    if (running || !db.isEnabled) return;
    running = true;
    try {
      const before = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const pending = await db.selectRows('fixture_delete_requests', { select: 'id,discord_id,snapshot', or: `(status.eq.pending,and(status.eq.sending,updated_at.lt.${before}))`, order: 'created_at.asc', limit: 5 });
      if (!pending.ok) return; // Migration may not have been installed yet.
      for (const job of pending.data || []) {
        const claim = await db.request('rpc/claim_fixture_delete', { method: 'POST', body: { p_request: job.id } });
        if (!claim.ok || !claim.data) continue;
        const token = claim.data;
        try {
          if (job.discord_id !== ADMIN || !['ash','exclusivo','tematico'].includes(job.snapshot?.tournament?.tipo)) throw Error('Destino o liga no autorizados');
          const text = `OLE · COPIA RECUPERABLE DEL FIXTURE\nSolicitud: ${job.id}\nTorneo: ${job.snapshot.tournament.nombre}\n\nEsta copia se envía ANTES de intentar el borrado. Consultá el estado en la web.\nPara recuperar: torneo → ⋯ → Fixture → Borrar / recuperar fixture → Recuperar copia.\nSe conservan partidos, IDs, equipos, configuración y fechas. No modifica estadísticas de jugadores.\n\n${JSON.stringify(job.snapshot, null, 2)}`;
          const attachment = Buffer.from(text, 'utf8');
          if (attachment.length > 7 * 1024 * 1024) throw Error('Copia demasiado grande para enviar por MD');
          const user = await client.users.fetch(ADMIN);
          const delivered = await user.send({ content: 'Copia de seguridad del fixture solicitada desde OLE. El borrado se intentará después de entregar este archivo.', files: [{ attachment, name: `fixture-${job.id}.txt` }], allowedMentions: { parse: [] } });
          const result = await db.request('rpc/complete_fixture_delete', { method: 'POST', body: { p_request: job.id, p_token: token, p_message_id: delivered.id } });
          if (!result.ok) throw Error('No se pudo confirmar el borrado. Revisá el estado en la web.');
        } catch (error) {
          await db.request('fixture_delete_requests', { method: 'PATCH', params: { id: `eq.${job.id}`, claim_token: `eq.${token}`, status: 'eq.sending' }, body: { status: 'failed', message: error?.code === 50007 ? 'Discord no permite enviarte MD. No se borró el fixture.' : 'No se pudo completar la operación. Revisá tus MD y volvé a intentar.', updated_at: new Date().toISOString() } });
        }
      }
    } finally { running = false; }
  };
}
module.exports = { createFixtureBackupWorker };
