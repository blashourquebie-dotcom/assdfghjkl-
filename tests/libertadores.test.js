const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildInitialFixture, buildNextRound, validateConfig } = require('../utils/tournamentFormat');
const { assertTournamentComplete } = require('../utils/tournamentCompletion');
const cfg = { formato: 'libertadores', grupos: 8, equipos_por_grupo: 4, clasifican: 2, ida_vuelta: false };
const teams = Array.from({ length: 32 }, (_, i) => ({ id: String(i) }));
const played = rows => rows.map(m => ({ ...m, jugado: true, goles_local: Number(m.club_local_id) < Number(m.club_visitante_id) ? 2 : 0, goles_visitante: Number(m.club_local_id) > Number(m.club_visitante_id) ? 2 : 0 }));
test('Libertadores 8x4: 48 partidos, grupos aislados y octavos cruzados', () => {
 const rows = buildInitialFixture(teams, cfg);
 assert.equal(rows.length, 48);
 assert.equal(new Set(rows.map(m => m.grupo)).size, 8);
 assert.ok(rows.every(m => Number(m.club_local_id) % 8 === Number(m.club_visitante_id) % 8));
 const next = buildNextRound(played(rows), cfg);
 assert.equal(next.rows.length, 8);
 assert.deepEqual(next.rows.slice(0, 4).map(m => [m.club_local_id, m.club_visitante_id]), [['0','9'],['8','1'],['2','11'],['10','3']]);
 assert.ok(next.rows.every(m => m.ronda === 2 && m.fase === 'eliminacion' && m.grupo === null));
});
test('Libertadores disputa todas las rondas hasta la final, ida y vuelta', () => {
 for (const ida_vuelta of [false, true]) {
  const config = { ...cfg, ida_vuelta };
  let rows = played(buildInitialFixture(teams, config));
  assert.throws(() => assertTournamentComplete({ formato: config.formato, cantidad_equipos: 32, configuracion: config }, rows));
  for (let round = 2; round <= 5; round++) rows.push(...played(buildNextRound(rows, config).rows));
  assert.equal(rows.length, 63 * (ida_vuelta ? 2 : 1));
  assert.equal(buildNextRound(rows, config).champion, '0');
  assert.doesNotThrow(() => assertTournamentComplete({ formato: config.formato, cantidad_equipos: 32, configuracion: config }, rows));
 }
});
test('Rechaza clasificación ambigua, grupos incompletos, duplicados y tamaños inválidos', () => {
 const rows = played(buildInitialFixture(teams, cfg));
 assert.throws(() => buildNextRound(rows.slice(1), cfg), /incompleto/);
 assert.throws(() => buildNextRound([...rows.slice(1), rows[1]], cfg), /incompleto/);
 assert.throws(() => buildNextRound(rows.map(m => ({ ...m, goles_local: 0, goles_visitante: 0 })), cfg), /Empate/);
 assert.throws(() => validateConfig({ ...cfg, grupos: 6 }, 24), /clasificados/);
 assert.throws(() => validateConfig(cfg, 31), /misma cantidad/);
 assert.throws(() => buildInitialFixture([...teams.slice(1), teams[1]], cfg), /duplicados/);
});
test('Wizard permite editar grupos, omitir tamaño (4) y guarda configuración', async () => {
 const wizard = require('../utils/tournamentWizard');
 const db = require('../utils/haxoleSupabase');
 const original = { request: db.request, ensureModalidad: db.ensureModalidad };
 let preview, modal, stored;
 const interaction = { user: { id: 'owner' }, guildId: '1293616776747286631', member: { permissions: { has: () => true } }, reply: async p => { preview = p; }, showModal: async p => { modal = p.toJSON(); }, deferUpdate: async () => {}, editReply: async () => {}, followUp: async p => { throw Error(p.content); } };
 await wizard.begin(interaction, { name: 'Copa', count: 32, modality: 'x3', tipo: 'ash', formato: 'libertadores' });
 const id = preview.components[0].components[0].data.custom_id.split(':')[2];
 interaction.awaitModalSubmit = async () => ({ fields: { getTextInputValue: key => ({ legs: 'si', groups: '4', qualifiers: '2', tags: '' })[key] }, update: async p => { preview = p; }, reply: async p => { throw Error(p.content); } });
 await wizard.handle(interaction, ['advanced', id]);
 assert.ok(modal.components.length <= 5);
 assert.match(preview.embeds[0].data.description, /Grupos: 4 · 4 equipos/);
 try {
  db.ensureModalidad = async () => ({ id: 'mode' });
  db.request = async (_, options) => { stored = options.body; return { ok: true }; };
  await wizard.handle(interaction, ['save', id]);
  assert.equal(stored.cantidad_equipos, 16);
  assert.equal(stored.configuracion.grupos, 4);
  assert.equal(stored.configuracion.equipos_por_grupo, 4);
  assert.equal(stored.configuracion.ida_vuelta, true);
 } finally { Object.assign(db, original); }
});
