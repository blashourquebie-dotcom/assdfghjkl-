const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const { unique } = require("../utils/serverSetup");

const renderStatus = (enabled) => (enabled ? "Activo" : "No activo");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("configuracion")
    .setDescription("Muestra o cambia configuraciones del bot")
    .addSubcommand((sub) =>
      sub
        .setName("ver")
        .setDescription("Muestra la configuracion actual")
    )
    .addSubcommand((sub) =>
      sub
        .setName("desactivar")
        .setDescription("Desactiva una opcion")
        .addStringOption((opt) =>
          opt
            .setName("opcion")
            .setDescription("Opcion a desactivar")
            .setRequired(true)
            .addChoices(
              { name: "Apodos automaticos", value: "apodos" },
              { name: "Roles de club debajo de jugador", value: "orden_roles" },
              { name: "Anti spam", value: "antispam" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("activar")
        .setDescription("Activa una opcion")
        .addStringOption((opt) =>
          opt
            .setName("opcion")
            .setDescription("Opcion a activar")
            .setRequired(true)
            .addChoices(
              { name: "Apodos automaticos", value: "apodos" },
              { name: "Roles de club debajo de jugador", value: "orden_roles" },
              { name: "Anti spam", value: "antispam" }
            )
        )
        .addChannelOption((opt) =>
          opt
            .setName("canal")
            .setDescription("Canal de anti spam")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar /configuracion.", flags: 64 });
    }

    const sub = interaction.options.getSubcommand();
    const cfg = readConfig();
    cfg.automation = cfg.automation || {
      autoNicknames: true,
      clubRolesBelowPlayer: true,
      antiSpam: { enabled: false, channelId: null }
    };

    if (sub === "ver") {
      const guildSetup = cfg.guilds?.[interaction.guild.id]?.setup || {};
      const embed = new EmbedBuilder()
        .setTitle("Configuracion del bot")
        .setColor(0x3498db)
        .setDescription([
          `Apodos automaticos: **${renderStatus(cfg.automation.autoNicknames !== false)}**`,
          `Roles de club debajo de jugador: **${renderStatus(cfg.automation.clubRolesBelowPlayer !== false)}**`,
          `Anti spam: **${renderStatus(cfg.automation.antiSpam?.enabled)}**`,
          cfg.automation.antiSpam?.channelId ? `Canal anti spam: <#${cfg.automation.antiSpam.channelId}>` : "Canal anti spam: sin definir",
          `Servidor: **${guildSetup.serverLabel || "general"}**`,
          `Modalidades activas: **${(cfg.enabledModalities || []).join(", ") || "ninguna"}**`,
          `Modo de instalacion: **${guildSetup.mode || "sin definir"}**`,
          guildSetup.modalities?.length ? `Modalidades instaladas: **${unique(guildSetup.modalities).join(", ")}**` : "Modalidades instaladas: ninguna"
        ].join("\n"));

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const option = interaction.options.getString("opcion");
    const enabled = sub === "activar";

    if (option === "apodos") {
      cfg.automation.autoNicknames = enabled;
    } else if (option === "orden_roles") {
      cfg.automation.clubRolesBelowPlayer = enabled;
    } else if (option === "antispam") {
      cfg.automation.antiSpam = cfg.automation.antiSpam || { enabled: false, channelId: null };
      cfg.automation.antiSpam.enabled = enabled;
      if (enabled) {
        const channel = interaction.options.getChannel("canal");
        if (channel) cfg.automation.antiSpam.channelId = channel.id;
      }
    }

    saveConfig(cfg);
    return interaction.reply({
      content: enabled
        ? `OK. \`${option}\` quedo activado.`
        : `OK. \`${option}\` quedo desactivado.`,
      flags: 64
    });
  }
};
