const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const market = require("../utils/market");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("abrirmercado")
    .setDescription("Abre temporalmente el mercado de una modalidad")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("tiempo").setDescription("Duracion, ej: 2h, 12hs, 1d, 3 dias").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden abrir mercado.", flags: 64 });
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
      open: true,
      forceClosed: false,
      usage: {},
      manualMode: "open",
      manualUntil,
      openedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    saveConfig(cfg);

    const embed = new EmbedBuilder()
      .setTitle("\uD83D\uDFE2 Mercado abierto")
      .setDescription(`El mercado de **${modality}** queda abierto temporalmente.`)
      .addFields(
        { name: "\u23F1\uFE0F Duracion", value: `\`${durationRaw}\``, inline: true },
        { name: "\u23F3 Termina en", value: market.formatRemaining(manualUntil), inline: true },
        { name: "\uD83D\uDD04 Usos", value: "Reiniciados en 0", inline: true }
      )
      .setColor(0x2ecc71)
      .setTimestamp(new Date(manualUntil));

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};
