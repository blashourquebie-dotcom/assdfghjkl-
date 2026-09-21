const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { incrementThreadCount, getThreadLink } = require("../utils/antiDf");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("darantidf")
    .setDescription("Suma 1 al contador de anti-df del hilo vinculado"),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const link = getThreadLink(interaction.guild.id, interaction.channel.id);
    if (!link) {
      return interaction.reply({ content: "Este hilo no esta vinculado a anti-df.", flags: 64 });
    }

    const updated = incrementThreadCount(interaction.guild.id, interaction.channel.id, 1);
    return interaction.reply({
      content: updated?.tournament
        ? `ANTI-DF de **${link.modality} / ${updated.tournament}**: **${updated.count}**`
        : `ANTI-DF de **${link.modality}**: **${updated.count}**`,
      flags: 64
    });
  }
};
