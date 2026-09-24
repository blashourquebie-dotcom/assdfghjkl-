const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, addHistory } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const { sendCapActionAlert } = require("../utils/alerts");
const validators = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sc")
    .setDescription("Asigna subcapitan general de un club")
    .addStringOption((opt) => opt.setName("club").setDescription("Nombre o abreviacion del club").setRequired(true).setAutocomplete(true))
    .addUserOption((opt) => opt.setName("usuario").setDescription("Nuevo subcapitan").setRequired(true)),

  async execute(interaction) {
    const link = readConfig().forumClubs?.[interaction.channel?.id] || readConfig().forumClubs?.[interaction.channel?.parentId];
    const clubQ = interaction.options.getString("club") || link?.club;
    const usuario = interaction.options.getUser("usuario");
    const cfg = readConfig();
    const clubEntry = clubs.findClub(clubQ);
    if (!clubEntry) return interaction.reply({ content: `No encontre el club **${clubQ || ""}**.`, flags: 64 });

    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const captainMods = Object.entries(cfg.clubs?.[clubEntry.name]?.captains || {})
      .filter(([, userId]) => String(userId) === String(interaction.user.id))
      .map(([mod]) => mod);
    if (!isAdmin && !captainMods.length) {
      return interaction.reply({ content: "Solo administradores o CAPs vinculados a este club pueden asignar SC.", flags: 64 });
    }

    const member = await interaction.guild.members.fetch(usuario.id).catch(() => null);
    if (!member) return interaction.reply({ content: "Usuario no encontrado.", flags: 64 });

    const clubRoles = Object.values(clubEntry.roles || {});
    const hasClubRole = clubRoles.some((roleId) => member.roles.cache.has(roleId));
    if (!hasClubRole) {
      return interaction.reply({ content: `**${usuario.tag}** primero debe estar fichado en **${clubEntry.name}**.`, flags: 64 });
    }

    const captainInMods = Object.entries(cfg.clubs?.[clubEntry.name]?.captains || {})
      .filter(([, userId]) => String(userId) === String(usuario.id))
      .map(([mod]) => mod);
    if (captainInMods.length) {
      return interaction.reply({
        content: `**${usuario.tag}** ya es CAP en **${clubEntry.name}** (${captainInMods.join(", ")}). No puede ser CAP y SC a la vez en la misma modalidad.`,
        flags: 64
      });
    }

    for (const [rawMod, roleId] of Object.entries(clubEntry.roles || {})) {
      const mod = roleRegistry.normalizeModality(rawMod);
      if (!mod || !member.roles.cache.has(roleId)) continue;
      const limit = Number(cfg.subcaptainLimits?.[mod] ?? cfg.subcaptainLimit ?? 1);
      const nextCount = new Set([usuario.id, cfg.clubs[clubEntry.name]?.subcaptains?.[mod]].filter(Boolean)).size;
      if (limit > 0 && nextCount > limit) {
        return interaction.reply({ content: `**${clubEntry.name} ${mod}** quedaria con ${nextCount}/${limit} SC. Quita la asignacion anterior antes de agregar otra.`, flags: 64 });
      }
    }

    cfg.clubs[clubEntry.name].subcaptains = cfg.clubs[clubEntry.name].subcaptains || {};
    const previousSC = cfg.clubs[clubEntry.name].subcaptains.general;
    cfg.clubs[clubEntry.name].subcaptains.general = usuario.id;
    saveConfig(cfg);
    addHistory(usuario.id, "SC", { club: clubEntry.name, by: interaction.user.tag });

    if (previousSC && String(previousSC) !== String(usuario.id)) {
      const previousMember = await interaction.guild.members.fetch(previousSC).catch(() => null);
      if (previousMember) for (const [rawMod, clubRoleId] of Object.entries(clubEntry.roles || {})) {
        const mod = roleRegistry.normalizeModality(rawMod);
        if (!mod || !previousMember.roles.cache.has(clubRoleId)) continue;
        const stillSC = Object.values(cfg.clubs || {}).some((club) =>
          String(club?.subcaptains?.general || "") === String(previousSC)
          || String(club?.subcaptains?.[mod] || "") === String(previousSC));
        const oldRoleId = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "subcaptain")?.roleId;
        if (!stillSC && oldRoleId && previousMember.roles.cache.has(oldRoleId)) {
          await previousMember.roles.remove(oldRoleId, `SC reemplazado en ${clubEntry.name}`).catch(() => null);
        }
      }
    }

    for (const [mod, roleId] of Object.entries(clubEntry.roles || {})) {
      if (!member.roles.cache.has(roleId)) continue;
      const scRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "subcaptain");
      if (scRole?.roleId && !member.roles.cache.has(scRole.roleId)) {
        await member.roles.add(scRole.roleId, `Rol SC agregado por /sc en ${clubEntry.name}`).catch(() => null);
      }
    }

    for (const mod of Object.keys(clubEntry.roles || {})) {
      await updateLinkedForumTemplates(interaction.guild, clubEntry.name, mod).catch(() => null);
    }

    await sendCapActionAlert(interaction, {
      action: "Asignacion de SC",
      club: clubEntry.name,
      modality: captainMods.join(", "),
      targets: [usuario.id]
    }).catch(() => null);

    return interaction.reply({
      content: `✅ **${usuario.tag}** ahora es SC general de **${clubEntry.name}**.`,
      flags: 64
    });
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "club") return;
      const options = clubs.searchClubs(focused.value)
        .slice(0, 25)
        .map((club) => ({
          name: club.abbr ? `${club.name} (${club.abbr})` : club.name,
          value: club.name
        }));
      await interaction.respond(options);
    } catch (error) {
      console.error("[sc.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
