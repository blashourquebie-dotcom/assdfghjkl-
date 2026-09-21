const { SlashCommandBuilder } = require("discord.js");
const { runDivisionChange } = require("../utils/divisionCommands");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("primera")
    .setDescription("Marca el club del foro como primera division en esta modalidad"),

  async execute(interaction) {
    return runDivisionChange(interaction, "1ra", "Club marcado como primera division");
  }
};
