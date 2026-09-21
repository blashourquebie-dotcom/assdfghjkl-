const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/haxoleSupabase');
const schedule = require('./schedule');

module.exports = {
  data: new SlashCommandBuilder().setName('torneo').setDescription('Configura los pases libres de una copa antes de crear el fixture')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('modalidad').setDescription('Modalidad del torneo').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('torneo').setDescription('Copa a configurar').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('pases_libres').setDescription('Nombres exactos o IDs separados por ;. Omitir para consultar. "ninguno" para vaciar.')),
  autocomplete: schedule.autocomplete,
  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Solo administradores.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    try {
      const tournaments = await db.listTorneosByModalidad(interaction.options.getString('modalidad'));
      const name = interaction.options.getString('torneo');
      const tournament = tournaments.find(t => t.nombre.toLowerCase() === name.toLowerCase());
      if (!tournament || !(tournament.formato === 'copa' || tournament.modo_copa)) throw new Error('Elegí un torneo con formato Copa.');
      const rows = await db.getTournamentClubRows(tournament.id);
      const required = 2 ** Math.ceil(Math.log2(tournament.cantidad_equipos)) - tournament.cantidad_equipos;
      const value = interaction.options.getString('pases_libres');
      const label = r => r.club?.nombre || r.club_id;
      if (value === null) return interaction.editReply({ content: ('Copa: ' + tournament.nombre + '\nPases libres necesarios: ' + required + '\nElegidos: ' + (rows.filter(r => (tournament.configuracion?.pases_libres || []).includes(r.club_id)).map(label).join('; ') || 'Ninguno') + '\nClubes inscriptos: ' + (rows.map(label).join('; ') || 'Ninguno') + '\nUsá pases_libres con los nombres separados por ; antes de /schedule crear.').slice(0, 2000) });
      const names = value.trim().toLowerCase() === 'ninguno' ? [] : value.split(';').map(n => n.trim());
      const ids = names.map(n => {
        const found = rows.filter(r => r.club_id === n || label(r).toLowerCase() === n.toLowerCase());
        if (found.length !== 1) throw new Error('Club no inscripto o ambiguo: ' + n + '. Usá su ID si hay nombres repetidos.');
        return found[0].club_id;
      });
      if (ids.length !== required || new Set(ids).size !== ids.length) throw new Error('Seleccioná exactamente ' + required + ' clubes distintos.');
      const saved = await db.request('rpc/configure_cup_byes', { method: 'POST', body: { p_tournament: tournament.id, p_clubs: ids } });
      if (!saved.ok) throw new Error('No se guardó: comprobá que no exista fixture y que esté aplicada la migración de pases libres.');
      return interaction.editReply({ content: 'Pases libres guardados: ' + (names.join('; ') || 'Ninguno') + '. Continuá con /schedule crear.' });
    } catch (error) { return interaction.editReply({ content: error.message }); }
  }
};
