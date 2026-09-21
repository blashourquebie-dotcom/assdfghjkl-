const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const { ensureGeneralRolesForModality, unique, ensureGuildBucket } = require("../utils/serverSetup");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("agregarmodalidad")
    .setDescription("Agrega una modalidad con roles y limites opcionales")
    .addStringOption((opt) =>
      opt
        .setName("modalidad")
        .setDescription("Nombre de la modalidad, ej: x8 o rs-x8")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limite_jugadores")
        .setDescription("Limite de jugadores para la modalidad")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limite_sc")
        .setDescription("Limite de subcapitanes para la modalidad")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar /agregarmodalidad.", flags: 64 });
    }

    const cfg = readConfig();
    const guild = interaction.guild;
    const guildId = guild.id;
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const playerLimit = interaction.options.getInteger("limite_jugadores");
    const scLimit = interaction.options.getInteger("limite_sc");

    if (!modality) {
      return interaction.reply({ content: "Modalidad invalida. Usa algo como `x8` o `rs-x8`.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const roles = await ensureGeneralRolesForModality(guild, cfg, guildId, modality, {
      reason: `Alta de modalidad ${modality}`,
      ensureSecondDivision: true,
      keepClubRolesBelowPlayer: cfg.automation?.clubRolesBelowPlayer !== false
    });

    cfg.enabledModalities = unique([
      ...(cfg.enabledModalities || []).map((mod) => roleRegistry.normalizeModality(mod)),
      modality
    ]);

    if (!cfg.roleLimits || typeof cfg.roleLimits !== "object") cfg.roleLimits = {};
    if (playerLimit !== null && playerLimit !== undefined) {
      cfg.roleLimits[modality] = playerLimit;
    }

    if (!cfg.subcaptainLimits || typeof cfg.subcaptainLimits !== "object") cfg.subcaptainLimits = {};
    if (scLimit !== null && scLimit !== undefined) {
      cfg.subcaptainLimits[modality] = scLimit;
    }

    const bucket = ensureGuildBucket(cfg, guildId);
    bucket.setup = bucket.setup || {};
    bucket.setup.modalities = unique([...(bucket.setup.modalities || []), modality]);
    bucket.setup.lastAddedModality = modality;
    bucket.setup.updatedAt = new Date().toISOString();

    saveConfig(cfg);

    const embed = new EmbedBuilder()
      .setTitle("Modalidad agregada")
      .setColor(0x2ecc71)
      .setDescription([
        `Modalidad: **${modality}**`,
        `Roles: ${[roles?.player?.name, roles?.captain?.name, roles?.subcaptain?.name, roles?.secondDivision?.name].filter(Boolean).join(" / ")}`,
        playerLimit !== null && playerLimit !== undefined ? `Limite de jugadores: **${playerLimit}**` : "Limite de jugadores: sin cambios",
        scLimit !== null && scLimit !== undefined ? `Limite de SC: **${scLimit}**` : "Limite de SC: sin cambios"
      ].join("\n"));

    return interaction.editReply({ embeds: [embed] });
  }
};
