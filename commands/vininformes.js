const { SlashCommandBuilder } = require("discord.js");
const base = require("./vincularinformes");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vininformes")
    .setDescription("Alias de /vincularinformes")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("torneo").setDescription("Nombre del torneo").setRequired(true)),
  execute: base.execute
};
