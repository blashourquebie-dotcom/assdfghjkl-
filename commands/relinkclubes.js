const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const clubs = require("../utils/clubs");
const { ensureGeneralRolesForModality } = require("../utils/serverSetup");
const { ensureClubRoleForModality } = require("../utils/clubRoleRecovery");
const { updateLinkedForumTemplates } = require("../utils/plantillas");

const parseModalities = (raw) => {
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw)
        .replace(/\s+/g, ",")
        .split(",")
        .map((mod) => roleRegistry.normalizeModality(mod))
        .filter(Boolean)
    )
  );
};

const gatherKnownModalities = (cfg, guildId) => {
  const mods = new Set();
  const add = (value) => {
    const mod = roleRegistry.normalizeModality(value);
    if (mod) mods.add(mod);
  };

  for (const mod of cfg.enabledModalities || []) add(mod);
  for (const mod of Object.keys(cfg.enabledRoles?.[guildId] || {})) add(mod);
  for (const mod of Object.keys(cfg.generalRoles?.[guildId] || {})) add(mod);
  for (const club of Object.values(cfg.clubs || {})) {
    for (const mod of Object.keys(club?.roles || {})) add(mod);
    for (const mod of Object.keys(club?.captains || {})) add(mod);
    for (const mod of Object.keys(club?.subcaptains || {})) add(mod);
  }

  return Array.from(mods);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("relinkclubes")
    .setDescription("Reconstruye y vuelve a vincular los roles de clubes y modalidades")
    .addStringOption((opt) =>
      opt
        .setName("modalidades")
        .setDescription("Opcional: modalidades separadas por coma; vacio = todas las conocidas")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const cfg = readConfig();
    const guild = interaction.guild;
    const requested = parseModalities(interaction.options.getString("modalidades"));
    const known = gatherKnownModalities(cfg, guild.id);
    const modalities = requested.length ? requested : known;

    if (!modalities.length) {
      return interaction.reply({ content: "No encontre modalidades para re-vincular.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    await guild.members.fetch().catch(() => null);

    const lines = [];
    let recreatedGeneral = 0;
    let relinkedClubs = 0;
    let createdClubs = 0;

    for (const mod of modalities) {
      const general = await ensureGeneralRolesForModality(guild, cfg, guild.id, mod, {
        reason: `Re-vinculo de roles para ${mod}`,
        ensureSecondDivision: true,
        keepClubRolesBelowPlayer: cfg.automation?.clubRolesBelowPlayer !== false
      }).catch(() => null);
      if (general) {
        recreatedGeneral += [general.player, general.captain, general.subcaptain, general.secondDivision].filter(Boolean).length;
      }
    }

    for (const clubEntry of clubs.getAllClubs()) {
      const baseModalities = Object.keys(clubEntry.roles || {})
        .map((mod) => roleRegistry.normalizeModality(mod))
        .filter(Boolean);
      const clubModalities = new Set(
        (requested.length ? baseModalities.filter((mod) => modalities.includes(mod)) : baseModalities)
      );

      for (const mod of clubModalities) {
        const result = await ensureClubRoleForModality(guild, cfg, clubEntry, mod, {
          reason: `Re-vinculo de club ${clubEntry.name} ${mod}`
        }).catch(() => null);
        if (!result?.role) continue;
        if (result.created) createdClubs += 1;
        else if (result.relinked) relinkedClubs += 1;

        await updateLinkedForumTemplates(guild, clubEntry.name, mod).catch(() => null);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("Re-vinculo completado")
      .setColor(0x2ecc71)
      .setDescription([
        `Modalidades procesadas: **${modalities.join(", ")}**`,
        `Roles base recreados: **${recreatedGeneral}**`,
        `Roles de clubes recreados: **${createdClubs}**`,
        `Roles de clubes re-vinculados: **${relinkedClubs}**`
      ].join("\n"));

    return interaction.editReply({ embeds: [embed] });
  }
};
