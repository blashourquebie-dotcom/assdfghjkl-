const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const roleRegistry = require("../utils/roleRegistry");
const seasons = require("../utils/seasons");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("deshabilitarmodalidad")
    .setDescription("Marca una modalidad como inactiva sin borrar datos historicos")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x7 o rs-x4").setRequired(true))
    .addStringOption((o) => o.setName("razon").setDescription("Motivo opcional").setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden deshabilitar modalidades.", flags: 64 });
    }

    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    if (!modality) return interaction.reply({ content: "Modalidad invalida.", flags: 64 });

    const activeSeason = seasons.getActiveSeason(modality);
    if (activeSeason) {
      return interaction.reply({
        content: `No puedo deshabilitar **${modality}** porque tiene temporada activa: **${activeSeason.name}**.`,
        flags: 64
      });
    }

    const entry = seasons.setInactiveModality(modality, {
      by: interaction.user?.tag || interaction.user?.id,
      reason: interaction.options.getString("razon")
    });

    return interaction.reply({
      content: `Modalidad **${entry.modality}** marcada como inactiva. No se borraron datos historicos.`,
      flags: 64
    });
  }
};
