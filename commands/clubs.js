const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { readConfig, readUsers } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const divisions = require("../utils/divisions");

const DEFAULT_CLUB_EMOJI = "<:HaxOle:1495228748851839240>";
const FIELD_LIMIT = 1024;

const splitIntoFields = (title, lines) => {
  const fields = [];
  let current = title ? `${title}\n` : "";

  for (const line of lines) {
    const candidate = `${current}${line}\n`;
    if (candidate.length > FIELD_LIMIT) {
      if (current.trim()) fields.push(current.trimEnd());
      current = title ? `${title}\n${line}\n` : `${line}\n`;
      continue;
    }

    current = candidate;
  }

  if (current.trim()) fields.push(current.trimEnd());
  return fields;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clubs")
    .setDescription("Muestra los clubes con cantidad de jugadores por modalidad")
    .addStringOption((option) =>
      option.setName("modalidad")
        .setDescription("Modalidad a mostrar")
        .setRequired(false)
        .addChoices(
          { name: "X3", value: "x3" },
          { name: "X4", value: "x4" },
          { name: "X5", value: "x5" },
          { name: "X7", value: "x7" },
          { name: "RS-X4", value: "rs-x4" },
          { name: "Todas", value: "all" }
        )),

  async execute(interaction) {
    try {
      const cfg = readConfig();
      const clubEntries = cfg.clubs || {};
      const users = readUsers(interaction.guild.id);
      const requestedModality = interaction.options.getString("modalidad") || "all";

      const modalities = requestedModality === "all"
        ? roleRegistry.getEnabledModalities(cfg)
        : [roleRegistry.normalizeModality(requestedModality)].filter(Boolean);

      if (!modalities.length) {
        return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
      }

      const embed = new EmbedBuilder()
        .setTitle("## Clubes registrados")
        .setColor(0x00AE86)
        .setDescription("Listado por modalidad y division.");

      for (const mod of modalities) {
        const modClubs = Object.entries(clubEntries).filter(([, data]) => data.roles?.[mod]);
        if (!modClubs.length) continue;

        const buckets = new Map([
          ["1ra", []],
          ["2da", []],
          ["Sin division", []]
        ]);

        for (const [name, data] of modClubs) {
          const roleId = data.roles?.[mod];
          const division = divisions.getClubDivision(cfg, name, mod) || "Sin division";
          const count = Object.values(users).filter((userData) => userData?.clubRoles?.[mod] === roleId).length;
          const emoji = data.emoji || DEFAULT_CLUB_EMOJI;
          const bucket = buckets.get(division) || buckets.get("Sin division");
          bucket.push(`${emoji} **${name}** (${data.abbr || "-"}) - ${count}`);
        }

        let added = 0;
        for (const [division, entries] of buckets.entries()) {
          if (!entries.length) continue;
          const chunks = splitIntoFields(`### ${division}`, entries);
          for (let index = 0; index < chunks.length; index += 1) {
            embed.addFields({
              name: index === 0 ? `## ${mod.toUpperCase()} · ${division}` : `## ${mod.toUpperCase()} · ${division} (${index + 1})`,
              value: chunks[index].slice(0, FIELD_LIMIT),
              inline: false
            });
            added += 1;
          }
        }

        if (!added) {
          embed.addFields({
            name: `## ${mod.toUpperCase()}`,
            value: "No hay clubes registrados.",
            inline: false
          });
        }
      }

      if (!embed.data.fields?.length) embed.setDescription("No hay clubes registrados.");

      return interaction.reply({ embeds: [embed], flags: 64 });
    } catch (error) {
      console.error("Error en clubs:", error);
      return interaction.reply({ content: "Error al listar clubs.", flags: 64 });
    }
  }
};
