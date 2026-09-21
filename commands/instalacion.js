const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const {
  DEFAULT_MODALITIES,
  unique,
  ensureGuildBucket,
  ensureGeneralRolesForModality,
  ensureTemplate
} = require("../utils/serverSetup");

const parseModalities = (raw) => {
  if (!raw) return [];
  return unique(
    String(raw)
      .replace(/\s+/g, ",")
      .split(",")
      .map((mod) => roleRegistry.normalizeModality(mod))
  );
};

const askConfirm = (what) => `Falta confirmar ${what}. Vuelve a ejecutar el comando con la confirmacion activada.`;

const deleteTrackedRoles = async (guild, cfg, guildId) => {
  const bucket = cfg.guilds?.[guildId]?.setup;
  const tracked = Array.isArray(bucket?.trackedRoleIds) ? bucket.trackedRoleIds : [];
  const deleted = [];

  for (const roleId of tracked) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    await role.delete("Instalacion reiniciada por administrador").catch(() => null);
    deleted.push(role.name);
  }

  if (bucket) bucket.trackedRoleIds = [];
  return deleted;
};

const buildSummary = ({ mode, action, modalities, roleReport, deletedRoles, channelReport, overwrite }) => {
  const lines = [
    `Modo: **${mode}**`,
    `Accion: **${action}**`,
    `Modalidades: **${modalities.join(", ")}**`,
    roleReport.length ? `Roles: ${roleReport.join(" | ")}` : "Roles: sin cambios",
    deletedRoles.length ? `Roles borrados: ${deletedRoles.join(", ")}` : "Roles borrados: ninguno",
    channelReport.length ? `Canales: ${channelReport.join(" | ")}` : "Canales: sin cambios",
    overwrite ? "La plantilla se sobreescribio." : "La plantilla se reutilizo o actualizo sin borrar todo."
  ];

  return lines.join("\n");
};

const makeLeagueGroup = (group) =>
  group
    .addSubcommand((sub) =>
      sub
        .setName("roles")
        .setDescription("Crea o verifica la plantilla de roles")
        .addStringOption((opt) =>
          opt
            .setName("modalidades")
            .setDescription("Modalidades separadas por coma; vacio usa las actuales o x3,x4,x5,x7")
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("sobreescribir")
            .setDescription("Borrar y recrear los roles de instalacion")
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("confirmar_sobreescribir")
            .setDescription("Confirma que queres borrar y recrear los roles")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("canales")
        .setDescription("Crea o verifica la plantilla de canales")
        .addStringOption((opt) =>
          opt
            .setName("modalidades")
            .setDescription("Modalidades separadas por coma; vacio usa las actuales o x3,x4,x5,x7")
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("sobreescribir")
            .setDescription("Borrar y recrear los canales de la plantilla")
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("confirmar_sobreescribir")
            .setDescription("Confirma que queres borrar y recrear los canales")
            .setRequired(false)
        )
    );

module.exports = {
  data: new SlashCommandBuilder()
    .setName("instalacion")
    .setDescription("Prepara el servidor para el bot")
    .addSubcommandGroup((group) => makeLeagueGroup(group.setName("liga").setDescription("Configura el server como normalmente lo haria la liga")))
    .addSubcommandGroup((group) =>
      group
        .setName("club")
        .setDescription("Configura el server para un club; por ahora esta deshabilitado")
        .addSubcommand((sub) => sub.setName("configurar").setDescription("Por ahora deshabilitado"))
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar /instalacion.", flags: 64 });
    }

    const guild = interaction.guild;
    const guildId = guild.id;
    const cfg = readConfig();
    const bucket = ensureGuildBucket(cfg, guildId);
    const setupBucket = bucket.setup;

    const mode = interaction.options.getSubcommandGroup();
    const action = interaction.options.getSubcommand();

    if (mode === "club") {
      return interaction.reply({
        content: "La rama `club` de /instalacion esta deshabilitada por ahora.",
        flags: 64
      });
    }

    if (mode !== "liga" || !["roles", "canales"].includes(action)) {
      return interaction.reply({ content: "Elegi `liga` y luego `roles` o `canales`.", flags: 64 });
    }

    const requestedModalities = parseModalities(interaction.options.getString("modalidades"));
    const overwrite = interaction.options.getBoolean("sobreescribir") === true;
    const confirmOverwrite = interaction.options.getBoolean("confirmar_sobreescribir") === true;

    if (overwrite && !confirmOverwrite) {
      return interaction.reply({ content: askConfirm(`sobreescritura de ${action}`), flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const modalities = unique(
      requestedModalities.length
        ? requestedModalities
        : unique([
            ...(cfg.enabledModalities || []).map((mod) => roleRegistry.normalizeModality(mod)),
            ...DEFAULT_MODALITIES
          ])
    );

    if (!modalities.length) {
      return interaction.editReply({ content: "No pude detectar modalidades validas para la instalacion." });
    }

    const deletedRoles = [];
    const roleReport = [];
    let channelReport = [];

    if (action === "roles") {
      if (overwrite) {
        const removed = await deleteTrackedRoles(guild, cfg, guildId);
        deletedRoles.push(...removed);
      }

      for (const modality of modalities) {
        const roles = await ensureGeneralRolesForModality(guild, cfg, guildId, modality, {
          reason: `Instalacion (${mode} / roles)`,
          ensureSecondDivision: true,
          keepClubRolesBelowPlayer: cfg.automation?.clubRolesBelowPlayer !== false
        });
        if (!roles) continue;

        roleReport.push(`${modality}: ${[roles.player?.name, roles.captain?.name, roles.subcaptain?.name, roles.secondDivision?.name].filter(Boolean).join(" / ")}`);
        setupBucket.trackedRoleIds = unique([
          ...(setupBucket.trackedRoleIds || []),
          roles.player?.id,
          roles.captain?.id,
          roles.subcaptain?.id,
          roles.secondDivision?.id
        ]);
      }

      cfg.enabledModalities = unique([
        ...(cfg.enabledModalities || []).map((mod) => roleRegistry.normalizeModality(mod)),
        ...modalities
      ]);
    }

    if (action === "canales") {
      const template = await ensureTemplate(guild, cfg, modalities, {
        wipeChannels: overwrite,
        mode: "liga"
      });
      channelReport = [
        `Creados/reusados: ${template.created.length + template.reused.length}`,
        template.created.length ? `Creados: ${template.created.slice(0, 12).join(", ")}` : null,
        template.reused.length ? `Reusados: ${template.reused.slice(0, 12).join(", ")}` : null
      ].filter(Boolean);
    }

    setupBucket.mode = mode;
    setupBucket.lastAction = action;
    setupBucket.modalities = modalities;
    setupBucket.updatedAt = new Date().toISOString();
    setupBucket.updatedBy = { id: interaction.user.id, tag: interaction.user.tag };

    saveConfig(cfg);

    const embed = new EmbedBuilder()
      .setTitle("Instalacion lista")
      .setColor(0x2ecc71)
      .setDescription(buildSummary({
        mode,
        action,
        modalities,
        roleReport,
        deletedRoles,
        channelReport,
        overwrite
      }));

    return interaction.editReply({ embeds: [embed] });
  }
};
