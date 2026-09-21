const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");

const findCaptainClub = (cfg, userId, modality) => {
  for (const [clubName, club] of Object.entries(cfg.clubs || {})) {
    if (String(club?.captains?.[modality] || "") === String(userId)) return clubName;
  }
  return null;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cederfichajes")
    .setDescription("Cede una carga extra de fichaje a otro CAP")
    .addUserOption((o) => o.setName("usuario").setDescription("CAP que recibe la carga").setRequired(true))
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad; opcional en foro vinculado").setRequired(false)),

  async execute(interaction) {
    const cfg = readConfig();
    const link = cfg.forumClubs?.[interaction.channel?.id];
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad") || link?.modality);
    const target = interaction.options.getUser("usuario");
    if (!modality) return interaction.reply({ content: "Modalidad invalida o no encontrada en este foro.", flags: 64 });

    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const sourceClub = findCaptainClub(cfg, interaction.user.id, modality);
    if (!isAdmin && !sourceClub) {
      return interaction.reply({ content: "Solo un CAP de esa modalidad o un admin puede ceder fichajes.", flags: 64 });
    }

    const targetClub = findCaptainClub(cfg, target.id, modality);
    if (!targetClub) return interaction.reply({ content: `${target.tag} no figura como CAP en **${modality}**.`, flags: 64 });

    cfg.markets = cfg.markets || {};
    cfg.markets[modality] = cfg.markets[modality] || {};
    cfg.markets[modality].bonus = cfg.markets[modality].bonus || {};
    const key = targetClub.toLowerCase();
    cfg.markets[modality].bonus[key] = Number(cfg.markets[modality].bonus[key] || 0) + 1;
    saveConfig(cfg);

    return interaction.reply({
      content: `Carga cedida. **${targetClub} ${modality}** ahora tiene +1 fichaje disponible en este mercado.`,
      flags: 64
    });
  }
};
