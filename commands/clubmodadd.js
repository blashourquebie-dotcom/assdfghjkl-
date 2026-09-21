const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const clubsUtil = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { maybePlaceBelow } = require("../utils/serverSetup");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clubmodadd")
    .setDescription("Agrega una modalidad a un club ya habilitado")
    .addStringOption((o) => o.setName("club").setDescription("Nombre del club").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad a agregar").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "âŒ Solo administradores pueden usar este comando.", flags: 64 });
    }

    const clubQ = interaction.options.getString("club");
    const modRaw = interaction.options.getString("modalidad");

    console.log(`[clubmodadd] Agregando modalidad ${modRaw} a club ${clubQ}`);

    const cfg = readConfig();
    const clubEntry = clubsUtil.findClub(clubQ);
    if (!clubEntry) {
      return interaction.reply({ content: `âš ï¸ Club **${clubQ}** no encontrado`, flags: 64 });
    }

    if (modRaw.includes(",")) {
      return interaction.reply({
        content: "âŒ Debes indicar una sola modalidad. Usa /habilitarclub si quieres cargar varias juntas.",
        flags: 64
      });
    }

    const mod = roleRegistry.normalizeModality(modRaw);
    if (!mod) {
      return interaction.reply({ content: "âŒ Modalidad invÃ¡lida.", flags: 64 });
    }

    if (!roleRegistry.isEnabledModality(cfg, mod)) {
      const allowed = roleRegistry.getEnabledModalities(cfg);
      return interaction.reply({
        content: `âŒ La modalidad **${mod}** no estÃ¡ habilitada globalmente.${allowed.length ? ` Modalidades vÃ¡lidas: ${allowed.join(", ")}` : ""}`,
        flags: 64
      });
    }

    if (clubEntry.roles?.[mod]) {
      return interaction.reply({ content: `âš ï¸ El club **${clubEntry.name}** ya tiene la modalidad **${mod}**.`, flags: 64 });
    }

    try {
      const gid = interaction.guild.id;
      const role = await interaction.guild.roles.create({
        name: `${clubEntry.name} ${mod}`,
        colors: { primaryColor: 0xFFFFFF },
        reason: `Rol creado por /clubmodadd para ${clubEntry.name} ${mod}`
      });

      clubsUtil.linkRoleToClub(clubEntry.name, mod, role.id);

      const cfgClub = readConfig();
      if (!cfgClub.clubs[clubEntry.name].affiliations) cfgClub.clubs[clubEntry.name].affiliations = {};
      cfgClub.clubs[clubEntry.name].affiliations[mod] = {
        date: new Date().toISOString(),
        by: interaction.user.tag,
        roleId: role.id
      };
      saveConfig(cfgClub);

      const cfgAfter = readConfig();
      roleRegistry.addClubRole(cfgAfter, gid, mod, {
        roleId: role.id,
        name: clubEntry.name,
        createdAt: new Date().toISOString()
      });
      if (cfgAfter.roleLimits?.[mod] && !cfgAfter.roleLimits?.[role.id]) {
        cfgAfter.roleLimits[role.id] = cfgAfter.roleLimits[mod];
      }
      saveConfig(cfgAfter);

      if (readConfig().automation?.clubRolesBelowPlayer !== false) {
        const playerRole = roleRegistry.getGeneralRole(cfgAfter, gid, mod, "player");
        const anchorRole = playerRole?.roleId
          ? interaction.guild.roles.cache.get(playerRole.roleId) || await interaction.guild.roles.fetch(playerRole.roleId).catch(() => null)
          : null;
        await maybePlaceBelow(interaction.guild, role, anchorRole).catch(() => null);
      }

      console.log(`[clubmodadd] Modalidad ${mod} agregada a club ${clubEntry.name}`);
      return interaction.reply({
        content: `âœ… Modalidad **${mod}** agregada a club **${clubEntry.name}** (${clubEntry.abbr}). Rol creado: ${role.name}`,
        flags: 64
      });
    } catch (error) {
      console.error("[clubmodadd] Error:", error);
      return interaction.reply({ content: "âŒ Error al agregar la modalidad.", flags: 64 });
    }
  },

  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "club") {
      const cfg = readConfig();
      const clubNames = Object.keys(cfg.clubs || {});
      const filtered = clubNames.filter((c) => c.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      await interaction.respond(filtered.map((c) => ({ name: c, value: c })));
    }
  }
};
