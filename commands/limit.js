const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const clubs = require("../utils/clubs");
const { updateLinkedForumTemplates } = require("../utils/plantillas");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("limit")
    .setDescription("Establece o elimina un limite de usuarios por modalidad")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad: x3 / x4 / x5 / x7 / rs-x4").setRequired(true))
    .addIntegerOption((o) => o.setName("max").setDescription("Maximo de usuarios permitidos (0 para quitar limite)").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder().setTitle("âŒ Permisos").setDescription("Solo administradores pueden usar /limit").setColor(0xE74C3C);
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const modalityRaw = interaction.options.getString("modalidad") || "";
    const max = interaction.options.getInteger("max");
    const modality = roleRegistry.normalizeModality(modalityRaw);

    console.log(`[limit] Estableciendo limite en ${modality} a ${max}`);

    try {
      const cfg = readConfig();
      if (!cfg.roleLimits) cfg.roleLimits = {};
      const gid = interaction.guild.id;

      const roleMention = modalityRaw.match(/^<@&?(\d+)>$/) || modalityRaw.match(/^(\d+)$/);
      if (roleMention) {
        const roleId = roleMention[1];
        if (max <= 0) {
          delete cfg.roleLimits[roleId];
          saveConfig(cfg);
          return interaction.reply({
            embeds: [new EmbedBuilder().setTitle("âœ… Limite eliminado").setDescription(`Limite eliminado para rol <@&${roleId}>`).setColor(0x2ecc71)],
            flags: 64
          });
        }

        cfg.roleLimits[roleId] = max;
        saveConfig(cfg);
        return interaction.reply({
          embeds: [new EmbedBuilder().setTitle("âœ… Limite establecido").setDescription(`Rol <@&${roleId}> â†’ **${max}** usuarios`).setColor(0x2ecc71)],
          flags: 64
        });
      }

      if (!modality) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setTitle("âŒ Modalidad invÃ¡lida").setDescription("Debes indicar una modalidad vÃ¡lida o un rol.").setColor(0xE74C3C)],
          flags: 64
        });
      }

      if (!roleRegistry.isEnabledModality(cfg, modality)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setTitle("âŒ Modalidad no habilitada").setDescription(`La modalidad **${modality}** no estÃ¡ habilitada globalmente.`).setColor(0xE74C3C)],
          flags: 64
        });
      }

      const enabled = cfg.enabledRoles?.[gid]?.[modality] || [];
      const clubRoleIds = Object.values(cfg.clubs || {})
        .map((club) => club?.roles?.[modality])
        .filter(Boolean);
      const allRoleIds = Array.from(new Set([
        ...enabled.map((entry) => entry.roleId).filter(Boolean),
        ...clubRoleIds
      ]));

      if (!allRoleIds.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setTitle("âš ï¸ Sin roles").setDescription(`No se encontraron roles para la modalidad **${modality}** en este servidor.`).setColor(0xE67E22)],
          flags: 64
        });
      }

      if (max <= 0) {
        delete cfg.roleLimits[modality];
        for (const roleId of allRoleIds) {
          delete cfg.roleLimits[roleId];
        }
        saveConfig(cfg);
        for (const club of clubs.getAllClubs()) {
          if (clubs.getRoleForClub(club, modality)) await updateLinkedForumTemplates(interaction.guild, club.name, modality).catch(() => null);
        }
        return interaction.reply({
          embeds: [new EmbedBuilder().setTitle("âœ… Limites eliminados").setDescription(`Limites eliminados para modalidad **${modality}**`).setColor(0x2ecc71)],
          flags: 64
        });
      }

      cfg.roleLimits[modality] = max;
      for (const roleId of allRoleIds) {
        cfg.roleLimits[roleId] = max;
      }
      saveConfig(cfg);

      for (const club of clubs.getAllClubs()) {
        if (clubs.getRoleForClub(club, modality)) await updateLinkedForumTemplates(interaction.guild, club.name, modality).catch(() => null);
      }

      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("âœ… Limite establecido").setDescription(`Modalidad **${modality}** â†’ **${max}** usuarios (aplicado a ${allRoleIds.length} roles)`).setColor(0x2ecc71)],
        flags: 64
      });
    } catch (error) {
      console.error("Error en /limit:", error);
      const embed = new EmbedBuilder().setTitle("âŒ Error").setDescription("Error al establecer limite").setColor(0xE74C3C);
      return interaction.reply({ embeds: [embed], flags: 64 });
    }
  }
};
