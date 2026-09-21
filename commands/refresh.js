const { SlashCommandBuilder } = require("discord.js");
const syncRoles = require("./sincronizarroles");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Sincroniza plantillas y roles del servidor")
    .addStringOption((opt) =>
      opt
        .setName("modalidades")
        .setDescription("Opcional: modalidades separadas por coma; vacio = todas las conocidas")
        .setRequired(false)
    ),

  execute: syncRoles.execute
};
