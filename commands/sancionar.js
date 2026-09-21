const { SlashCommandBuilder } = require("discord.js");
const sanctions = require("../utils/sanctions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sancionar")
    .setDescription("Sanciona uno o varios usuarios por tiempo")
    .addStringOption((o) => o.setName("usuarios").setDescription("Menciones o IDs separados por coma").setRequired(true))
    .addStringOption((o) => o.setName("tiempo").setDescription("Ej: 1s semanas, 2m meses, 3a anios").setRequired(true))
    .addStringOption((o) => o.setName("modalidad").setDescription("Opcional: x3, x4 o x3,x4").setRequired(false))
    .addStringOption((o) => o.setName("razon").setDescription("Razon de la sancion").setRequired(false)),

  async execute(interaction) {
    if (!sanctions.canModerate(interaction)) {
      return interaction.reply({ content: "Solo administradores pueden sancionar.", flags: 64 });
    }

    const rawUsers = interaction.options.getString("usuarios");
    const duration = sanctions.parseDuration(interaction.options.getString("tiempo"));
    const modalities = sanctions.parseModalities(interaction.options.getString("modalidad"));
    const reason = interaction.options.getString("razon") || "Sin razon";
    const userIds = sanctions.parseUserIds(rawUsers);

    if (!userIds.length) return interaction.reply({ content: "Menciona al menos un usuario valido.", flags: 64 });
    if (!duration) return interaction.reply({ content: "Tiempo invalido. Usa `1s` semanas, `2m` meses o `3a` anios.", flags: 64 });

    const lines = [];
    const scopes = modalities.length ? modalities : [null];
    for (const userId of userIds) {
      for (const modality of scopes) {
        const result = await sanctions.applySanction({ interaction, userId, duration, reason, modality });
        lines.push(result.line);
      }
    }

    return interaction.reply({
      content: [
        "# Sanciones aplicadas",
        `**Modalidad:** ${modalities.length ? modalities.join(", ") : "general"}`,
        `**Razon:** ${reason}`,
        "",
        ...lines
      ].join("\n"),
      flags: 64
    });
  }
};
