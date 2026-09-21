const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const roleRegistry = require("../utils/roleRegistry");
const seasons = require("../utils/seasons");
const statsStore = require("../utils/statsStore");

const MODALITY_CHOICES = [
  { name: "General", value: "general" },
  { name: "x3", value: "x3" },
  { name: "x4", value: "x4" },
  { name: "x5", value: "x5" },
  { name: "x7", value: "x7" }
];

const DIVISION_CHOICES = [
  { name: "Todas", value: "all" },
  { name: "1ra", value: "1ra" },
  { name: "2da", value: "2da" },
  { name: "Sin division", value: "sin-division" }
];

const resolveScope = (raw) => {
  const value = String(raw || "general").trim().toLowerCase();
  if (value === "general") return null;
  return roleRegistry.normalizeModality(value);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tiers")
    .setDescription("Muestra el ranking de tiers por modalidad o general")
    .addStringOption((o) =>
      o
        .setName("modalidad")
        .setDescription("general, x3, x4, x5 o x7")
        .setRequired(false)
        .addChoices(...MODALITY_CHOICES))
    .addStringOption((o) =>
      o
        .setName("temporada")
        .setDescription("Opcional: nombre de temporada")
        .setRequired(false))
    .addStringOption((o) =>
      o
        .setName("division")
        .setDescription("Opcional: 1ra, 2da, sin division o todas")
        .setRequired(false)
        .addChoices(...DIVISION_CHOICES)),

  async execute(interaction) {
    const selected = interaction.options.getString("modalidad") || "general";
    const scope = resolveScope(selected);
    const seasonName = interaction.options.getString("temporada");
    const divisionOption = interaction.options.getString("division") || "all";
    const division = divisionOption === "all" ? null : divisionOption;
    const season = seasonName
      ? seasons.findSeason({ name: seasonName, modality: scope || null, includeFinished: true })
      : null;

    if (seasonName && !season) {
      return interaction.reply({
        content: scope
          ? "No encontre esa temporada para la modalidad indicada."
          : "No encontre esa temporada.",
        flags: 64
      });
    }

    const rows = statsStore.aggregateTierPoints({
      modality: scope,
      seasonId: season?.id || null,
      division
    });

    const titleParts = [scope ? scope.toUpperCase() : "GENERAL"];
    if (division) titleParts.push(division.toUpperCase());
    if (season) titleParts.push(season.name);

    const rowsByDivision = new Map();
    for (const row of rows) {
      const key = row.division || "sin-division";
      const list = rowsByDivision.get(key) || [];
      list.push(row);
      rowsByDivision.set(key, list);
    }

    const divisionsToRender = division ? [division] : Array.from(rowsByDivision.keys()).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
    const lines = divisionsToRender.flatMap((divisionKey) => {
      const divisionRows = (rowsByDivision.get(divisionKey) || []).slice(0, 10);
      if (!divisionRows.length) return [];
      const section = [`**${divisionKey.toUpperCase()}**`];
      divisionRows.forEach((row, index) => {
        const emoji = row.clubEmoji ? `${row.clubEmoji} ` : "";
        const modalities = row.modalities?.length ? row.modalities.join(", ") : "sin modalidad";
        const divisionLabel = row.division || "sin-division";
        section.push(`**${index + 1}.** ${row.displayName || row.userTag || `<@${row.userId}>`} - ${emoji}${row.clubName || "sin club"}: **${statsStore.formatTierPoints(row.points)} pts** \`[${modalities} | ${divisionLabel}]\``);
      });
      return section;
    });

    const embed = new EmbedBuilder()
      .setColor(0xb0091c)
      .setTitle(`Tiers - ${titleParts.join(" / ")}`)
      .setDescription(lines.join("\n") || "No hay stats cargadas para calcular tiers.");

    return interaction.reply({ embeds: [embed] });
  }
};
