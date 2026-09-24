const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const safeDelete = require("./borrartorneo");

// Keep the old name available, but never bypass the empty-tournament checks.
module.exports = {
  data: new SlashCommandBuilder()
    .setName("eliminartorneo")
    .setDescription("Alias de /borrartorneo: solo torneos vacíos, con confirmación")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName('liga').setDescription('Solo en PRUEBAS: liga a administrar').setRequired(false)
      .addChoices({ name: 'ASH', value: 'ash' }, { name: 'RoadToGlory', value: 'exclusivo' }, { name: 'Temático', value: 'tematico' })),
  execute: safeDelete.execute
};
