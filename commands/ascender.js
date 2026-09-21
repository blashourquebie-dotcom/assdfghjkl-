const { SlashCommandBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const divisions = require("../utils/divisions");
const { getLinkedClubContext, runDivisionChange } = require("../utils/divisionCommands");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ascender")
    .setDescription("Asciende el club del foro de segunda a primera division"),

  async execute(interaction) {
    const context = getLinkedClubContext(interaction);
    if (!context.error) {
      const current = divisions.getClubDivision(readConfig(), context.clubEntry.name, context.modality);
      if (current === "1ra") {
        return interaction.reply({
          content: `**${context.clubEntry.name} ${context.modality}** ya esta en primera division.`,
          flags: 64
        });
      }
    }
    return runDivisionChange(interaction, "1ra", "Club ascendido");
  }
};
