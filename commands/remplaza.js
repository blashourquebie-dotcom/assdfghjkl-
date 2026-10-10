const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/haxoleSupabase');
const clubs = require('../utils/clubs');
const scope = require('../utils/tournamentScope');
const roleRegistry = require('../utils/roleRegistry');
const { readConfig } = require('../utils/database');

async function outgoingClubs(modality) {
  if (!scope.currentLeague()) throw new Error('Usá este comando en el servidor de la liga.');
  const found = new Map();
  for (let offset = 0; ; offset += 500) {
    const result = await db.request('torneos', { params: {
      select: 'id,modalidad:modalidades!inner(nombre)', estado: 'eq.activo',
      ...(modality ? {'modalidad.nombre': `eq.${modality}`} : {}),
      order: 'id.asc', offset, limit: 500
    } });
    if (!result.ok) throw new Error('No pude consultar los participantes de esta liga.');
    for (const tournament of result.data || []) {
      const candidates = await db.request('rpc/tournament_replacement_candidates', {method:'POST',body:{p_id:tournament.id}});
      if (!candidates.ok) throw new Error('No pude consultar los cupos. Aplicá la migración de cupos vacantes.');
      for (const row of candidates.data || []) found.set(row.club_id, {id:row.club_id,nombre:row.nombre});
    }
    if ((result.data || []).length < 500) return [...found.values()];
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName('remplaza')
    .setDescription('Reemplaza un club en todos los torneos activos de esta liga')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('modalidad').setDescription('Modalidad cuyos torneos se reemplazan').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('club_remplazador').setDescription('Club habilitado que entra').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('club_remplazado').setDescription('Club que sale de los torneos activos').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    try {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.respond([]);
      const focused = interaction.options.getFocused(true);
      const query = String(focused.value || '').toLocaleLowerCase();
      if (focused.name === 'modalidad') return interaction.respond(roleRegistry.getEnabledModalities(readConfig()).filter(m=>m.includes(query)).slice(0,25).map(m=>({name:m,value:m})));
      const modality = roleRegistry.normalizeModality(interaction.options.getString('modalidad'));
      if (!modality) return interaction.respond([]);
      const options = focused.name === 'club_remplazador'
        ? clubs.getAllClubs().filter(c => clubs.getRoleForClub(c,modality)).map(c => ({ name: c.name, value: c.name }))
        : (await outgoingClubs(modality)).map(c => ({ name: c.nombre, value: c.id }));
      return interaction.respond(options.filter(c => c.name.toLocaleLowerCase().includes(query)).slice(0,25).map(c=>({...c,name:c.name.slice(0,100)})));
    } catch { return interaction.respond([]); }
  },
  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Solo administradores.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    try {
      const modality = roleRegistry.normalizeModality(interaction.options.getString('modalidad'));
      if (!modality) throw new Error('Elegí una modalidad válida.');
      const incoming = clubs.findClub(interaction.options.getString('club_remplazador'));
      if (!incoming || !clubs.getRoleForClub(incoming,modality)) throw new Error('El club entrante no está habilitado en esa modalidad.');
      const query = interaction.options.getString('club_remplazado');
      const outgoing = (await outgoingClubs(modality)).find(c => c.id === query || c.nombre.toLocaleLowerCase() === query.toLocaleLowerCase());
      if (!outgoing) throw new Error('El club saliente no está inscripto en torneos activos de esta liga.');
      const row = await db.ensureClubRow(incoming.name);
      if (!row?.id) throw new Error('No pude identificar el club entrante.');
      const result = await db.request('rpc/bot_replace_active_club', { method: 'POST', body: {
        p_old: outgoing.id, p_new: row.id, p_guild: interaction.guildId || interaction.guild.id, p_modality:modality
      } });
      if (!result.ok) {
        if (/PGRST202|Could not find the function|does not exist/i.test(String(result.error))) {
          throw new Error('Falta aplicar 202610040002_preserve_vacant_clubs.sql en Supabase. No se cambió ningún cupo.');
        }
        throw new Error(result.error || 'No se pudo reemplazar.');
      }
      return interaction.editReply({ content: `**${incoming.name}** reemplazó a **${outgoing.nombre}** en ${result.data} torneo(s). Los resultados y estadísticas pasan al club entrante; el fixture conserva el reemplazo.` });
    } catch (error) {
      return interaction.editReply({ content: `No se realizó el reemplazo: ${error.message}` });
    }
  }
};
