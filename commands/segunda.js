const { SlashCommandBuilder } = require("discord.js");
const { runDivisionChange } = require("../utils/divisionCommands");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("segunda")
    .setDescription("Marca el club del foro como segunda division en esta modalidad"),

  async execute(interaction) {
    return runDivisionChange(interaction, "2da", "Club marcado como segunda division");
  }
};
