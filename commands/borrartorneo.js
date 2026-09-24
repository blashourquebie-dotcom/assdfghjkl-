const { randomUUID } = require('node:crypto');
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../utils/haxoleSupabase');
const scope = require('../utils/tournamentScope');

const sessions = new Map();
const TIMEOUT_MS = 5 * 60 * 1000;
const data = new SlashCommandBuilder()
  .setName('borrartorneo')
  .setDescription('Elegí de una lista un torneo vacío para borrar')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option.setName('liga').setDescription('Solo en PRUEBAS: liga a administrar').setRequired(false)
    .addChoices({ name: 'ASH', value: 'ash' }, { name: 'RoadToGlory', value: 'exclusivo' }, { name: 'Temático', value: 'tematico' }));

function authorized(interaction, session) {
  return session && session.expires > Date.now() && session.owner === interaction.user.id &&
    session.guild === (interaction.guildId || interaction.guild?.id) &&
    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function selection(session, token) {
  const start = session.page * 25;
  const page = session.rows.slice(start, start + 25);
  const menu = new StringSelectMenuBuilder().setCustomId(`borrartorneo:choose:${token}`)
    .setPlaceholder('Seleccioná un torneo')
    .addOptions(page.map((row) => ({ label: row.nombre.slice(0, 100), description: `${row.modality} · ${row.estado || 'sin estado'}`.slice(0, 100), value: row.id })));
  const components = [new ActionRowBuilder().addComponents(menu)];
  if (session.rows.length > 25) components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`borrartorneo:page:prev:${token}`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(session.page === 0),
    new ButtonBuilder().setCustomId(`borrartorneo:page:next:${token}`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setDisabled(start + 25 >= session.rows.length)
  ));
  return { content: `Elegí el torneo de esta liga que querés borrar. Solo se pueden borrar torneos vacíos. Página ${session.page + 1}/${Math.ceil(session.rows.length / 25)}.`, components };
}

async function execute(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Solo administradores.', flags: 64 });
  if (!scope.currentLeague()) return interaction.reply({ content: 'Elegí una liga en PRUEBAS antes de borrar un torneo.', flags: 64 });
  await interaction.deferReply({ flags: 64 });
  try {
    const [tournaments, modalities] = await Promise.all([
      db.request('torneos', { params: { select: 'id,nombre,modalidad_id,estado', order: 'nombre.asc', limit: 1000 } }),
      db.request('modalidades', { params: { select: 'id,nombre', limit: 100 } })
    ]);
    if (!tournaments.ok || !modalities.ok) throw new Error('No pude cargar los torneos de esta liga.');
    const byId = new Map((modalities.data || []).map((row) => [row.id, row.nombre]));
    const rows = (tournaments.data || []).map((row) => ({ ...row, modality: byId.get(row.modalidad_id) })).filter((row) => row.modality);
    if (!rows.length) return interaction.editReply({ content: 'No hay torneos en esta liga.' });
    const token = randomUUID();
    sessions.set(token, { owner: interaction.user.id, guild: interaction.guildId || interaction.guild?.id, league: scope.currentLeague(), rows, page: 0, expires: Date.now() + TIMEOUT_MS });
    return interaction.editReply(selection(sessions.get(token), token));
  } catch (error) { return interaction.editReply({ content: error.message || 'No pude cargar los torneos.' }); }
}

const inSessionScope = (interaction, session, task) => session.guild === scope.TEST_GUILD
  ? scope.run({ guild: interaction.guild, guildId: session.guild, options: { getString: (name) => name === 'liga' ? session.league : null } }, task)
  : task();

async function handleSelect(interaction, [action, token]) {
  const session = sessions.get(token);
  if (!authorized(interaction, session) || action !== 'choose') return interaction.reply({ content: 'Selección vencida o no autorizada.', flags: 64 });
  const row = session.rows.find((item) => item.id === interaction.values[0]);
  if (!row) return interaction.reply({ content: 'El torneo no está en la lista.', flags: 64 });
  await interaction.deferUpdate();
  try {
    const inspected = await inSessionScope(interaction, session, () => db.inspectTournamentRemoval({ modality: row.modality, name: row.nombre }));
    if (!inspected || inspected.torneo.id !== row.id) throw new Error('El torneo cambió. Volvé a abrir la lista.');
    if (inspected.blockers.length) return interaction.editReply({ content: `No se puede borrar **${row.nombre}**: tiene ${inspected.blockers.join(', ')}.`, components: [] });
    session.selected = row;
    return interaction.editReply({ content: `¿Borrar **${row.nombre}** (${row.modality})? No tiene partidos, inscripciones ni historial vinculado.`, components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`borrartorneo:confirm:${token}`).setLabel('Sí, borrar torneo').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`borrartorneo:cancel:${token}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    )] });
  } catch (error) { return interaction.editReply({ content: error.message || 'No se pudo verificar el torneo.', components: [] }); }
}

async function handleComponent(interaction, [action, detail, possibleToken]) {
  const token = action === 'page' ? possibleToken : detail;
  const session = sessions.get(token);
  if (!authorized(interaction, session)) return interaction.reply({ content: 'Confirmación vencida o no autorizada.', flags: 64 });
  if (action === 'page') {
    session.page = Math.max(0, Math.min(Math.ceil(session.rows.length / 25) - 1, session.page + (detail === 'next' ? 1 : -1)));
    return interaction.update(selection(session, token));
  }
  if (action === 'cancel') { sessions.delete(token); return interaction.update({ content: 'Borrado cancelado.', components: [] }); }
  if (action !== 'confirm' || !session.selected) return interaction.reply({ content: 'Acción desconocida.', flags: 64 });
  const row = session.selected;
  sessions.delete(token);
  await interaction.deferUpdate();
  try {
    const inspected = await inSessionScope(interaction, session, () => db.inspectTournamentRemoval({ modality: row.modality, name: row.nombre }));
    if (!inspected || inspected.torneo.id !== row.id) throw new Error('El torneo cambió. No se borró nada.');
    const removed = await inSessionScope(interaction, session, () => db.removeTournament({ modality: row.modality, name: row.nombre }));
    if (!removed || removed.id !== row.id) throw new Error('No pude confirmar el borrado en Supabase.');
    return interaction.editReply({ content: `Torneo **${row.nombre}** borrado de **${row.modality}**.`, components: [] });
  } catch (error) { return interaction.editReply({ content: error.message || 'No se pudo borrar el torneo.', components: [] }); }
}

module.exports = { data, execute, handleSelect, handleComponent };
