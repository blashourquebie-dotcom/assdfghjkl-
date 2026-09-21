const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const haxoleSupabase = require("../utils/haxoleSupabase");
const roleRegistry = require("../utils/roleRegistry");

const parseRaw = (raw) => {
  const body = String(raw || "").trim().replace(/^\S+\s*/, "").trim();
  if (!body) return {};
  const parts = body.split(/\s+/).filter(Boolean);
  return {
    modalidad: parts[0] || null,
    torneo: parts.slice(1).join(" ") || null
  };
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("eliminartorneo")
    .setDescription("Elimina un torneo")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("torneo").setDescription("Nombre del torneo").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const parsed = parseRaw(interaction.sourceMessage?.content || "");
    const modalidad = roleRegistry.normalizeModality(interaction.options.getString("modalidad") || parsed.modalidad);
    const torneoName = interaction.options.getString("torneo") || parsed.torneo;

    if (!modalidad || !torneoName) {
      return interaction.reply({ content: "Modalidad o torneo invalido.", flags: 64 });
    }

    const removed = await haxoleSupabase.removeTournament({ modality: modalidad, name: torneoName });
    if (!removed) {
      return interaction.reply({
        content: `No encontre el torneo **${torneoName}** en **${modalidad}**.`,
        flags: 64
      });
    }

    return interaction.reply({
      content: `✅ Torneo **${removed.nombre}** eliminado de **${modalidad}**.`,
      flags: 64
    });
  }
};
