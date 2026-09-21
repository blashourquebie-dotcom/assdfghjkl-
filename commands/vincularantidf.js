const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const haxoleSupabase = require("../utils/haxoleSupabase");
const { linkThread, getThreadLink } = require("../utils/antiDf");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vincularantidf")
    .setDescription("Vincula este hilo para contar anti-df por modalidad")
    .addStringOption((o) =>
      o.setName("modalidad")
        .setDescription("Modalidad a vincular")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("torneo")
        .setDescription("Opcional: vincular solo este torneo")
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const tournament = interaction.options.getString("torneo") || null;
    if (!modality) {
      return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    }

    if (tournament && haxoleSupabase.isEnabled) {
      const torneoRow = await haxoleSupabase.getTournament({ modality, name: tournament });
      if (!torneoRow) {
        return interaction.reply({ content: `No encontre el torneo **${tournament}** en **${modality}**.`, flags: 64 });
      }
    }

    const linked = linkThread(interaction.guild.id, interaction.channel.id, modality, tournament);
    if (!linked) {
      return interaction.reply({ content: "No pude vincular este hilo.", flags: 64 });
    }

    const current = getThreadLink(interaction.guild.id, interaction.channel.id);
    return interaction.reply({
      content: current.tournament
        ? `Hilo vinculado a **${current.modality} / ${current.tournament}** para contar anti-df.`
        : `Hilo vinculado a **${current.modality}** para contar anti-df.`,
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
      console.error("[vincularantidf.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
