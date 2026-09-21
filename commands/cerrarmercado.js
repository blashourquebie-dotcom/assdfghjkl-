const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const market = require("../utils/market");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cerrarmercado")
    .setDescription("Cierra temporalmente el mercado de una modalidad")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("tiempo").setDescription("Duracion, ej: 2h, 12hs, 1d, 3 dias").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden cerrar mercado.", flags: 64 });
    }
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const durationRaw = interaction.options.getString("tiempo");
    const durationMs = market.parseDuration(durationRaw);
    if (!modality) return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    if (!durationMs) return interaction.reply({ content: "Tiempo invalido. Usa ejemplos como `2h`, `12hs`, `1d` o `3 dias`.", flags: 64 });

    const now = Date.now();
    const manualUntil = new Date(now + durationMs).toISOString();
    const cfg = readConfig();
    cfg.markets = cfg.markets || {};
    cfg.markets[modality] = {
      ...(cfg.markets[modality] || {}),
      open: false,
      forceClosed: true,
      manualMode: "closed",
      manualUntil,
      closedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    saveConfig(cfg);

    const embed = new EmbedBuilder()
      .setTitle("\uD83D\uDD34 Mercado cerrado")
      .setDescription(`El mercado de **${modality}** queda cerrado temporalmente.`)
      .addFields(
        { name: "\u23F1\uFE0F Duracion", value: `\`${durationRaw}\``, inline: true },
        { name: "\u23F3 Termina en", value: market.formatRemaining(manualUntil), inline: true },
        { name: "\uD83D\uDD12 Estado", value: "Fichajes bloqueados", inline: true }
      )
      .setColor(0xe74c3c)
      .setTimestamp(new Date(manualUntil));

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};
