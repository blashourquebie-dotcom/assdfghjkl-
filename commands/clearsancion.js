const { SlashCommandBuilder } = require("discord.js");
const sanctions = require("../utils/sanctions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clearsancion")
    .setDescription("Limpia o reduce sanciones activas")
    .addStringOption((o) => o.setName("usuarios").setDescription("Menciones o IDs separados por coma").setRequired(true))
    .addStringOption((o) => o.setName("tiempo").setDescription("Opcional: cuanto reducir, ej 1s, 2m, 3a").setRequired(false)),

  async execute(interaction) {
    if (!sanctions.canModerate(interaction)) {
      return interaction.reply({ content: "Solo administradores pueden limpiar sanciones.", flags: 64 });
    }

    const userIds = sanctions.parseUserIds(interaction.options.getString("usuarios"));
    const rawDuration = interaction.options.getString("tiempo");
    const duration = rawDuration ? sanctions.parseDuration(rawDuration) : null;

    if (!userIds.length) return interaction.reply({ content: "Menciona al menos un usuario valido.", flags: 64 });
    if (rawDuration && !duration) return interaction.reply({ content: "Tiempo invalido. Usa `1s`, `2m` o `3a`.", flags: 64 });

    const lines = [];
    for (const userId of userIds) {
      const result = await sanctions.clearSanction({ interaction, userId, duration });
      lines.push(result.line);
    }

    return interaction.reply({
      content: [`# Sanciones actualizadas`, "", ...lines].join("\n"),
      flags: 64
    });
  }
};
