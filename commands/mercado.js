const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const market = require("../utils/market");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mercado")
    .setDescription("Configura dias y limite de fichajes del mercado por modalidad")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addIntegerOption((o) => o.setName("cantidad").setDescription("Fichajes permitidos por mercado; 0 = sin limite").setRequired(true))
    .addStringOption((o) => o.setName("dias").setDescription("Dias habilitados separados por coma").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden configurar mercado.", flags: 64 });
    }

    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const maxSignings = interaction.options.getInteger("cantidad") ?? interaction.options.getInteger("max");
    const days = market.parseDays(interaction.options.getString("dias"));
    if (!modality) return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    if (!days.length) return interaction.reply({ content: "Indica dias validos, ej: viernes,sabado,domingo.", flags: 64 });

    const cfg = readConfig();
    cfg.markets = cfg.markets || {};
    cfg.markets[modality] = {
      ...(cfg.markets[modality] || {}),
      maxSignings,
      days,
      open: false,
      forceClosed: false,
      manualMode: undefined,
      manualUntil: undefined,
      usage: {},
      updatedAt: new Date().toISOString()
    };
    saveConfig(cfg);

    return interaction.reply({
      content: `Mercado de **${modality}** configurado: **${maxSignings}** fichajes, dias **${interaction.options.getString("dias")}**.`,
      flags: 64
    });
  }
};
