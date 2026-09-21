const { SlashCommandBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const divisions = require("../utils/divisions");
const { getLinkedClubContext, runDivisionChange } = require("../utils/divisionCommands");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("descender")
    .setDescription("Desciende el club del foro de primera a segunda division"),

  async execute(interaction) {
    const context = getLinkedClubContext(interaction);
    if (!context.error) {
      const current = divisions.getClubDivision(readConfig(), context.clubEntry.name, context.modality);
      if (current === "2da") {
        return interaction.reply({
          content: `**${context.clubEntry.name} ${context.modality}** ya esta en segunda division.`,
          flags: 64
        });
      }
    }
    return runDivisionChange(interaction, "2da", "Club descendido");
  }
};
