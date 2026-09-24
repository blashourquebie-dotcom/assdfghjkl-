const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const safeDelete = require("./borrartorneo");

// Keep the old name available, but never bypass the empty-tournament checks.
module.exports = {
  data: new SlashCommandBuilder()
    .setName("eliminartorneo")
    .setDescription("Alias de /borrartorneo: solo torneos vacíos, con confirmación")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName("modalidad").setDescription("Modalidad del torneo").setRequired(true))
    .addStringOption((option) => option.setName("torneo").setDescription("Nombre exacto del torneo").setRequired(true)),
  execute: safeDelete.execute
};
