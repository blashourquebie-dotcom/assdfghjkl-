const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Etiqueta este servidor para separar su configuracion")
    .addStringOption((o) =>
      o
        .setName("nombre")
        .setDescription("Ej: HAXOLE #TEMATICO. Vacio = general")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar /server.", flags: 64 });
    }

    const cfg = readConfig();
    const guildId = interaction.guild.id;
    if (!cfg.guilds || typeof cfg.guilds !== "object") cfg.guilds = {};
    if (!cfg.guilds[guildId] || typeof cfg.guilds[guildId] !== "object") cfg.guilds[guildId] = {};
    if (!cfg.guilds[guildId].setup || typeof cfg.guilds[guildId].setup !== "object") cfg.guilds[guildId].setup = {};

    const nombre = String(interaction.options.getString("nombre") || "").trim();
    cfg.guilds[guildId].setup.serverLabel = nombre || null;
    cfg.guilds[guildId].setup.serverScope = nombre ? "custom" : "general";
    cfg.guilds[guildId].setup.updatedAt = new Date().toISOString();
    cfg.guilds[guildId].setup.updatedBy = { id: interaction.user.id, tag: interaction.user.tag };

    saveConfig(cfg);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("Servidor configurado")
      .setDescription([
        `Servidor: **${nombre || "general"}**`,
        "Todo lo nuevo de este server quedara separado en su propio bucket de configuracion."
      ].join("\n"));

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};
