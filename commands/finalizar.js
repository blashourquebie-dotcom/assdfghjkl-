const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const haxoleSupabase = require("../utils/haxoleSupabase");
const roleRegistry = require("../utils/roleRegistry");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("finalizar")
    .setDescription("Marca un torneo como finalizado")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("torneo").setDescription("Nombre del torneo").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const name = interaction.options.getString("torneo");
    if (!modality) {
      return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    let updated;
    try {
      updated = await haxoleSupabase.updateTournament({ modality, name, patch: { estado: "finalizado" } });
    } catch (error) {
      return interaction.editReply({ content: error.message || "No pude verificar el torneo. No se finalizó." });
    }

    if (!updated) {
      return interaction.editReply({
        content: `No encontre el torneo **${name}** en **${modality}** o no pude actualizarlo.`,
        flags: 64
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("Torneo finalizado")
      .setColor(0x2ecc71)
      .setDescription(`**${updated.nombre}** en **${modality}** quedo marcado como **finalizado**.`);

    return interaction.editReply({ embeds: [embed] });
  }
};
