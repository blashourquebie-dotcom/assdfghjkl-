const { SlashCommandBuilder } = require("discord.js");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { renderClubTemplate } = require("../utils/plantillas");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("plantilla")
    .setDescription("Muestra la plantilla de un club en una modalidad")
    .addStringOption((opt) =>
      opt.setName("club")
        .setDescription("Nombre o abreviacion del club")
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption((opt) =>
      opt.setName("modalidad")
        .setDescription("Modalidad a consultar")
        .setRequired(true)
        .addChoices(
          { name: "X3", value: "x3" },
          { name: "X4", value: "x4" },
          { name: "X5", value: "x5" },
          { name: "X7", value: "x7" }
        )),

  async execute(interaction) {
    const clubQuery = interaction.options.getString("club");
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));

    try {
      const clubEntry = clubs.findClub(clubQuery);
      if (!clubEntry) {
        return interaction.reply({ content: `⚠️ Club "${clubQuery}" no encontrado.`, flags: 64 });
      }
      if (!modality) {
        return interaction.reply({ content: "❌ Modalidad invalida.", flags: 64 });
      }

      const content = await renderClubTemplate(interaction.guild, clubEntry, modality);
      if (!content) {
        return interaction.reply({
          content: `⚠️ El club **${clubEntry.name}** no tiene la modalidad **${modality}** habilitada.`,
          flags: 64
        });
      }

      return interaction.reply({ content, flags: 64 });
    } catch (err) {
      console.error("/plantilla error", err);
      return interaction.reply({ content: "❌ Ocurrio un error al generar la plantilla.", flags: 64 });
    }
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "club") return;

      const filtered = clubs.searchClubs(focused.value)
        .slice(0, 25)
        .map((club) => ({
          name: club.abbr ? `${club.name} (${club.abbr})` : club.name,
          value: club.name
        }));

      await interaction.respond(filtered);
    } catch (error) {
      console.error("[plantilla.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
