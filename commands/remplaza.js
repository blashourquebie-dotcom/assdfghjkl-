const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/haxoleSupabase');
const clubs = require('../utils/clubs');
const scope = require('../utils/tournamentScope');

async function outgoingClubs() {
  if (!scope.currentLeague()) throw new Error('Usá este comando en el servidor de la liga.');
  const found = new Map();
  for (let offset = 0; ; offset += 500) {
    const result = await db.request('torneo_clubes', { params: {
      select: 'club_id,club:clubes(id,nombre),torneo:torneos!inner(tipo,estado)',
      'torneo.tipo': `eq.${scope.currentLeague()}`, 'torneo.estado': 'eq.activo',
      order: 'torneo_id.asc,club_id.asc', offset, limit: 500
    } });
    if (!result.ok) throw new Error('No pude consultar los participantes de esta liga.');
    for (const row of result.data || []) if (row.club) found.set(row.club_id, row.club);
    if ((result.data || []).length < 500) return [...found.values()];
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName('remplaza')
    .setDescription('Reemplaza un club en todos los torneos activos de esta liga')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('club_remplazador').setDescription('Club habilitado que entra').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('club_remplazado').setDescription('Club que sale de los torneos activos').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    try {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.respond([]);
      const focused = interaction.options.getFocused(true);
      const query = String(focused.value || '').toLocaleLowerCase();
      const options = focused.name === 'club_remplazador'
        ? clubs.getAllClubs().filter(c => Object.values(c.roles || {}).some(Boolean)).map(c => ({ name: c.name, value: c.name }))
        : (await outgoingClubs()).map(c => ({ name: c.nombre, value: c.id }));
      return interaction.respond(options.filter(c => c.name.toLocaleLowerCase().includes(query)).slice(0,25).map(c=>({...c,name:c.name.slice(0,100)})));
    } catch { return interaction.respond([]); }
  },
  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Solo administradores.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    try {
      const incoming = clubs.findClub(interaction.options.getString('club_remplazador'));
      if (!incoming || !Object.values(incoming.roles || {}).some(Boolean)) throw new Error('El club entrante no está habilitado.');
      const query = interaction.options.getString('club_remplazado');
      const outgoing = (await outgoingClubs()).find(c => c.id === query || c.nombre.toLocaleLowerCase() === query.toLocaleLowerCase());
      if (!outgoing) throw new Error('El club saliente no está inscripto en torneos activos de esta liga.');
      const row = await db.ensureClubRow(incoming.name);
      if (!row?.id) throw new Error('No pude identificar el club entrante.');
      const result = await db.request('rpc/bot_replace_active_club', { method: 'POST', body: {
        p_old: outgoing.id, p_new: row.id, p_guild: interaction.guildId || interaction.guild.id
      } });
      if (!result.ok) {
        if (/PGRST202|Could not find the function|does not exist/i.test(String(result.error))) {
          throw new Error('Falta aplicar 202610040001_replace_active_club.sql en Supabase. No se cambió ningún cupo.');
        }
        throw new Error(result.error || 'No se pudo reemplazar.');
      }
      return interaction.editReply({ content: `**${incoming.name}** reemplazó a **${outgoing.nombre}** en ${result.data} torneo(s). Conserva los cupos; los partidos jugados mantienen su historial.` });
    } catch (error) {
      return interaction.editReply({ content: `No se realizó el reemplazo: ${error.message}` });
    }
  }
};
