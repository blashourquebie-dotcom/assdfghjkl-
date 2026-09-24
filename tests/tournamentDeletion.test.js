const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../utils/haxoleSupabase');
const scope = require('../utils/tournamentScope');
const command = require('../commands/borrartorneo');
const oldCommand = require('../commands/eliminartorneo');

const makeInteraction = () => {
  const replies = [];
  return {
    guildId: '1293616776747286631', guild: { id: '1293616776747286631' },
    user: { id: 'admin' }, member: { permissions: { has: () => true } },
    options: { getString: () => null }, values: ['t1'], replies,
    deferReply: async () => {}, deferUpdate: async () => {},
    reply: async (value) => { replies.push(value); return value; },
    editReply: async (value) => { replies.push(value); return value; },
    update: async (value) => { replies.push(value); return value; }
  };
};

const useListedTournament = async (fn) => {
  const original = db.request;
  db.request = async (table) => table === 'torneos'
    ? { ok: true, data: [{ id: 't1', nombre: 'LIGA DUPLICADA', modalidad_id: 'm1', estado: 'activo' }] }
    : { ok: true, data: [{ id: 'm1', nombre: 'x3' }] };
  try { return await fn(); } finally { db.request = original; }
};

test('/borrartorneo muestra lista, pero no confirma un torneo con partidos', async () => {
  const originalInspect = db.inspectTournamentRemoval;
  const originalRemove = db.removeTournament;
  let deleted = false;
  try {
    db.inspectTournamentRemoval = async () => ({ torneo: { id: 't1', nombre: 'LIGA DUPLICADA' }, blockers: ['partidos'] });
    db.removeTournament = async () => { deleted = true; };
    await useListedTournament(async () => {
      const interaction = makeInteraction();
      await scope.run(interaction, () => command.execute(interaction));
      const menu = interaction.replies.at(-1).components[0].components[0];
      const [, , token] = menu.data.custom_id.split(':');
      await command.handleSelect(interaction, ['choose', token]);
      assert.match(interaction.replies.at(-1).content, /tiene partidos/);
      assert.deepEqual(interaction.replies.at(-1).components, []);
    });
    assert.equal(deleted, false);
  } finally { db.inspectTournamentRemoval = originalInspect; db.removeTournament = originalRemove; }
});

test('/borrartorneo exige confirmación del mismo admin y vuelve a verificar', async () => {
  const originalInspect = db.inspectTournamentRemoval;
  const originalRemove = db.removeTournament;
  let inspected = 0;
  let deleted = false;
  try {
    db.inspectTournamentRemoval = async () => { inspected++; return { torneo: { id: 't1', nombre: 'LIGA DUPLICADA' }, blockers: [] }; };
    db.removeTournament = async () => { deleted = true; return { id: 't1' }; };
    await useListedTournament(async () => {
      const interaction = makeInteraction();
      await scope.run(interaction, () => command.execute(interaction));
      const [, , token] = interaction.replies.at(-1).components[0].components[0].data.custom_id.split(':');
      await command.handleSelect(interaction, ['choose', token]);
      const other = makeInteraction(); other.user.id = 'intruso';
      await command.handleComponent(other, ['confirm', token]);
      assert.equal(deleted, false);
      assert.match(other.replies.at(-1).content, /no autorizada/);
      await command.handleComponent(interaction, ['confirm', token]);
      assert.equal(deleted, true);
      assert.ok(inspected >= 2);
      assert.match(interaction.replies.at(-1).content, /borrado/);
      assert.equal(oldCommand.execute, command.execute);
    });
  } finally { db.inspectTournamentRemoval = originalInspect; db.removeTournament = originalRemove; }
});
