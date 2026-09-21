const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const haxoleSupabase = require("../utils/haxoleSupabase");
const { setModalityLimit, setTournamentLimit } = require("../utils/antiDf");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("limitantidf")
    .setDescription("Establece el limite de anti-df por modalidad")
    .addStringOption((o) =>
      o.setName("modalidad")
        .setDescription("Modalidad, ej: x3")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("torneo")
        .setDescription("Opcional: limitar solo este torneo")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption((o) =>
      o.setName("limite")
        .setDescription("Limite de anti-df")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const tournament = interaction.options.getString("torneo") || null;
    const limit = interaction.options.getInteger("limite");
    if (!modality) {
      return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    }

    if (tournament && haxoleSupabase.isEnabled) {
      const torneoRow = await haxoleSupabase.getTournament({ modality, name: tournament });
      if (!torneoRow) {
        return interaction.reply({ content: `No encontre el torneo **${tournament}** en **${modality}**.`, flags: 64 });
      }
    }

    const value = tournament
      ? setTournamentLimit(interaction.guild.id, modality, tournament, limit)
      : setModalityLimit(interaction.guild.id, modality, limit);

    return interaction.reply({
      content: tournament
        ? `Limite de anti-df para **${modality} / ${tournament}** fijado en **${value}**. Si ya habia hilos vinculados, quedan actualizados.`
        : `Limite de anti-df para **${modality}** fijado en **${value}**. Si ya habia hilos vinculados, quedan actualizados.`,
      flags: 64
    });
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));

      if (focused.name === "modalidad") {
        const query = String(focused.value || "").toLowerCase();
        const options = roleRegistry.getEnabledModalities(readConfig())
          .filter((mod) => !query || mod.includes(query))
          .slice(0, 25)
          .map((mod) => ({ name: mod, value: mod }));
        await interaction.respond(options);
        return;
      }

      if (focused.name === "torneo") {
        if (!modality || !haxoleSupabase.isEnabled) {
          await interaction.respond([]);
          return;
        }
        const torneos = await haxoleSupabase.listTorneosByModalidad(modality);
        const query = String(focused.value || "").toLowerCase();
        const options = torneos
          .filter((torneo) => !query || String(torneo.nombre || "").toLowerCase().includes(query))
          .slice(0, 25)
          .map((torneo) => ({ name: torneo.nombre, value: torneo.nombre }));
        await interaction.respond(options);
      }
    } catch (error) {
      console.error("[limitantidf.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
