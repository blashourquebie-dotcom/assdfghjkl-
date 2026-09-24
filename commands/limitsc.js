const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("limitsc")
    .setDescription("Establece o elimina el limite de subcapitanes por club")
    .addIntegerOption((o) => o.setName("max").setDescription("Maximo de SC por club (0 para quitar limite)").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar /limitsc.", flags: 64 });
    }

    const max = interaction.options.getInteger("max");
    const cfg = readConfig();
    if (max <= 0) {
      cfg.subcaptainLimit = 0;
      saveConfig(cfg);
      return interaction.reply({ content: "Limite de SC eliminado.", flags: 64 });
    }

    cfg.subcaptainLimit = max;
    saveConfig(cfg);
    return interaction.reply({ content: `Limite de SC establecido en **${max}** por club.`, flags: 64 });
  }
};
