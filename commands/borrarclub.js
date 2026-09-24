const { randomUUID } = require('node:crypto');
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { readConfig, saveConfig } = require('../utils/database');
const db = require('../utils/haxoleSupabase');
const disableClub = require('./deshabilitarclub');

const sessions = new Map();
const TIMEOUT_MS = 5 * 60 * 1000;
const data = new SlashCommandBuilder()
  .setName('borrarclub')
  .setDescription('Da de baja un club, conservando solo su historial finalizado')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

function authorized(interaction, session) {
  return session && session.expires > Date.now() && session.owner === interaction.user.id &&
    session.guild === (interaction.guildId || interaction.guild?.id) &&
    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function selection(session, token) {
  const start = session.page * 25;
  const menu = new StringSelectMenuBuilder().setCustomId(`borrarclub:choose:${token}`)
    .setPlaceholder('Seleccioná un club')
    .addOptions(session.rows.slice(start, start + 25).map((row, index) => ({ label: row.name.slice(0, 100), description: row.modalities.join(', ').slice(0, 100) || 'Sin modalidades', value: String(start + index) })));
  const components = [new ActionRowBuilder().addComponents(menu)];
  if (session.rows.length > 25) components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`borrarclub:page:prev:${token}`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(session.page === 0),
    new ButtonBuilder().setCustomId(`borrarclub:page:next:${token}`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setDisabled(start + 25 >= session.rows.length)
  ));
  return { content: `Elegí el club que querés borrar. Página ${session.page + 1}/${Math.ceil(session.rows.length / 25)}.`, components };
}

async function execute(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Solo administradores.', flags: 64 });
  const cfg = readConfig();
  const names = Object.keys(cfg.clubs || {});
  if (!names.length) return interaction.reply({ content: 'No hay clubes habilitados en este servidor.', flags: 64 });
  await interaction.deferReply({ flags: 64 });
  try {
    const result = await db.request('clubes', { params: { select: 'id,nombre,archived_at', limit: 1000 } });
    if (!result.ok) throw new Error('No pude consultar clubes en Supabase. Aplicá la migración de baja de clubes antes de usar este comando.');
    const byName = new Map((result.data || []).map((row) => [row.nombre.toLowerCase(), row]));
    const rows = names.map((name) => ({ name, modalities: Object.keys(cfg.clubs[name]?.roles || {}), dbRow: byName.get(name.toLowerCase()) || null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const token = randomUUID();
    sessions.set(token, { owner: interaction.user.id, guild: interaction.guildId || interaction.guild?.id, rows, page: 0, expires: Date.now() + TIMEOUT_MS });
    return interaction.editReply(selection(sessions.get(token), token));
  } catch (error) { return interaction.editReply({ content: error.message || 'No pude cargar los clubes.' }); }
}

async function handleSelect(interaction, [action, token]) {
  const session = sessions.get(token);
  if (!authorized(interaction, session) || action !== 'choose') return interaction.reply({ content: 'Selección vencida o no autorizada.', flags: 64 });
  const selected = session.rows[Number(interaction.values[0])];
  if (!selected) return interaction.reply({ content: 'El club no está en esta lista.', flags: 64 });
  session.selected = selected;
  return interaction.update({ content: `¿Borrar **${selected.name}**? Se deshabilitarán sus roles, jugadores y foros. Los partidos pendientes en torneos activos quedarán 1-0 por DF para el rival; los resultados ya jugados se conservan. Si un partido está en curso o tiene datos parciales, la baja se detendrá.`, components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`borrarclub:confirm:${token}`).setLabel('Sí, borrar club').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`borrarclub:cancel:${token}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  )] });
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
  const selected = session.selected;
  sessions.delete(token);
  await interaction.deferUpdate();
  try {
    if (!readConfig().clubs?.[selected.name]) throw new Error('El club cambió. Volvé a abrir la lista.');
    if (selected.dbRow) {
      const archived = await db.request('rpc/bot_archive_club', { method: 'POST', body: { p_id: selected.dbRow.id, p_expected_name: selected.dbRow.nombre, p_guild: interaction.guildId || interaction.guild.id } });
      if (!archived.ok) throw new Error(archived.status === 404 ? 'Falta aplicar la migración de baja de clubes en Supabase.' : `No se pudo archivar el club: ${archived.error || archived.status}`);
      if (archived.data !== true) throw new Error('El club cambió en la base de datos. No se deshabilitó.');
    }
    const current = readConfig();
    if (!Object.values(current.clubs?.[selected.name]?.roles || {}).some(Boolean)) {
      current.archivedClubs = current.archivedClubs || {};
      current.archivedClubs[selected.name] = { ...current.clubs[selected.name], archivedAt: new Date().toISOString(), disabledBy: interaction.user.id };
      delete current.clubs[selected.name];
      for (const [channelId, link] of Object.entries(current.forumClubs || {})) {
        if (String(link.club || '').toLowerCase() === selected.name.toLowerCase()) delete current.forumClubs[channelId];
      }
      saveConfig(current);
    } else {
      let response;
      const adapted = Object.create(interaction);
      adapted.options = { getString: (name) => name === 'club' ? selected.name : null, getBoolean: () => false };
      adapted.reply = async (payload) => { response = payload; return payload; };
      await disableClub.executeDisableClub(adapted);
      if (response?.embeds?.[0]?.data?.title !== 'Club deshabilitado') {
        throw new Error(`La baja en Supabase se guardó, pero el bot no terminó de deshabilitar los roles: ${response?.content || 'revisá los logs'}. Podés volver a ejecutar /borrarclub.`);
      }
    }
    return interaction.editReply({ content: `Club **${selected.name}** dado de baja. Los partidos pendientes se otorgaron 1-0 por DF a sus rivales; los resultados ya jugados se conservaron.`, components: [] });
  } catch (error) { return interaction.editReply({ content: error.message || 'No se pudo borrar el club.', components: [] }); }
}

module.exports = { data, execute, handleSelect, handleComponent };
