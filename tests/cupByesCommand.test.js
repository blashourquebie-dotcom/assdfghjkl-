const { test } = require('node:test');
const assert = require('node:assert/strict');
const command = require('../commands/torneo');
const db = require('../utils/haxoleSupabase');
test('/torneo configura únicamente clubes inscriptos y controla permisos', async () => {
  const originals = [db.listTorneosByModalidad, db.getTournamentClubRows, db.request];
  let saved, reply;
  db.listTorneosByModalidad = async () => [{ id: 'cup', nombre: 'Copa', formato: 'copa', cantidad_equipos: 14 }];
  db.getTournamentClubRows = async () => [{ club_id: 'a', club: { nombre: 'Uno' } }, { club_id: 'b', club: { nombre: 'Dos' } }];
  db.request = async (path, payload) => { saved = { path, ...payload }; return { ok: true }; };
  let value = 'Uno; Dos';
  const interaction = { member: { permissions: { has: () => true } }, options: { getString: name => name === 'modalidad' ? 'x3' : name === 'torneo' ? 'Copa' : value }, deferReply: async () => {}, editReply: async p => { reply = p.content; }, reply: async p => { reply = p.content; } };
  try {
    assert.equal(command.data.toJSON().name, 'torneo');
    await command.execute(interaction);
    assert.deepEqual(saved.body.p_clubs, ['a', 'b']);
    assert.equal(saved.path, 'rpc/configure_cup_byes');
    saved = null; value = 'Uno; Ajeno';
    await command.execute(interaction);
    assert.equal(saved, null); assert.match(reply, /no inscripto/);
    value = null; await command.execute(interaction); assert.match(reply, /Pases libres necesarios: 2/);
    interaction.member.permissions.has = () => false;
    await command.execute(interaction); assert.match(reply, /Solo administradores/);
  } finally { [db.listTorneosByModalidad, db.getTournamentClubRows, db.request] = originals; }
});
