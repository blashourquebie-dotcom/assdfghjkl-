const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, readUsers, saveUsers } = require("../utils/database");
const { collectManagedRoleIds } = require("../utils/clubRoleRecovery");

const CLEAN_PASSWORD = "252725";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("eliminarroles")
    .setDescription("Elimina todos los roles gestionados y sus vinculaciones")
    .addStringOption((opt) =>
      opt
        .setName("password")
        .setDescription("Clave de confirmacion")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const password = interaction.options.getString("password");
    if (password !== CLEAN_PASSWORD) {
      return interaction.reply({ content: "Clave incorrecta.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const cfg = readConfig();
    const guild = interaction.guild;
    const managedRoleIds = collectManagedRoleIds(cfg, guild.id);
    const deletedRoles = [];
    const failedRoles = [];

    await guild.members.fetch().catch(() => null);

    for (const roleId of managedRoleIds) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;
      try {
        await role.delete("Limpieza total solicitada por /eliminarroles");
        deletedRoles.push(role.name);
      } catch (error) {
        failedRoles.push(`${role.name || role.id} (${error?.code || "error"})`);
      }
    }

    for (const club of Object.values(cfg.clubs || {})) {
      if (!club || typeof club !== "object") continue;
      club.roles = {};
      club.captains = {};
      club.subcaptains = {};
      club.affiliations = {};
    }

    cfg.enabledRoles = {};
    cfg.generalRoles = {};
    cfg.divisionRoles = {};
    cfg.roleLimits = {};
    cfg.subcaptainLimits = {};
    cfg.forumClubs = {};
    cfg.pendingTransfers = {};

    saveConfig(cfg);

    const users = readUsers(guild.id);
    let cleanedUsers = 0;
    for (const user of Object.values(users || {})) {
      if (!user || typeof user !== "object") continue;
      const hadData = Boolean(
        (user.clubRoles && Object.keys(user.clubRoles).length) ||
        (user.clubAffiliations && Object.keys(user.clubAffiliations).length)
      );
      user.clubRoles = {};
      user.clubAffiliations = {};
      if (hadData) cleanedUsers += 1;
    }
    saveUsers(users);

    return interaction.editReply({
      content: [
        "✅ Limpieza total completada.",
        `Roles eliminados: **${deletedRoles.length}**`,
        `Usuarios desvinculados: **${cleanedUsers}**`,
        failedRoles.length ? `No se pudieron borrar algunos roles: ${failedRoles.join(", ")}` : null
      ].filter(Boolean).join("\n")
    });
  }
};
