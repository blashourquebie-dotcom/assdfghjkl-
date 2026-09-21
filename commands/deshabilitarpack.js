const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig, readUsers, saveUsers } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const nicknames = require("../utils/nicknames");
const divisions = require("../utils/divisions");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const clubPacks = require("../utils/clubPacks");

const normalize = (value) => String(value || "").trim().toLowerCase();

const removeUserDataForRole = (users, userId, clubName, modality, roleId, byTag) => {
  const user = users[userId];
  if (!user || typeof user !== "object") return false;

  let changed = false;
  user.clubRoles = user.clubRoles || {};
  user.clubAffiliations = user.clubAffiliations || {};
  user.history = Array.isArray(user.history) ? user.history : [];

  if (user.clubRoles[modality] === roleId) {
    delete user.clubRoles[modality];
    changed = true;
  }

  if (user.clubAffiliations[clubName]) {
    const modalities = user.clubAffiliations[clubName].modalities || {};
    if (!modalities[modality] || modalities[modality].roleId === roleId) {
      delete modalities[modality];
      changed = true;
    }
    if (!Object.keys(modalities).length) delete user.clubAffiliations[clubName];
  }

  if (changed) {
    user.history.push({
      action: "DESHABILITARPACK",
      details: { club: clubName, modality, roleId, by: byTag },
      timestamp: new Date().toISOString()
    });
  }

  return changed;
};

const userIsCaptainElsewhere = (cfg, clubName, modality, userId) => {
  return Object.entries(cfg.clubs || {}).some(([otherClubName, clubEntry]) => {
    if (otherClubName === clubName) return false;
    return clubEntry?.captains?.[modality] === userId;
  });
};

const userHasClubInModality = (users, userId, modality) => {
  const user = users[userId];
  if (!user || typeof user !== "object") return false;
  if (user.clubRoles?.[modality]) return true;
  return Object.values(user.clubAffiliations || {}).some((entry) => {
    return Boolean(entry?.modalities?.[modality]?.roleId);
  });
};

const memberHasOtherClubRoleInModality = (cfg, guildId, modality, removedRoleId, member) => {
  return roleRegistry.getClubRoles(cfg, guildId, modality)
    .some((entry) => entry?.roleId && entry.roleId !== removedRoleId && member.roles.cache.has(entry.roleId));
};

const extractEmojiId = (emojiValue) => {
  const match = String(emojiValue || "").match(/(\d{15,25})/);
  return match ? match[1] : null;
};

const deleteClubEmoji = async (guild, clubName, clubCfg) => {
  const emojiId = extractEmojiId(clubCfg?.emoji);
  if (!emojiId) return false;

  const emoji = guild.emojis.cache.get(emojiId) || await guild.emojis.fetch(emojiId).catch(() => null);
  if (!emoji) return false;

  await emoji.delete(`Emoji eliminado por /deshabilitarpack para ${clubName}`).catch(() => null);
  return true;
};

const commandData = new SlashCommandBuilder()
  .setName("deshabilitarpack")
  .setDescription("Deshabilita un pack completo de clubes")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((opt) =>
    opt
      .setName("pack")
      .setDescription("Pack a deshabilitar")
      .setRequired(true)
      .setAutocomplete(true)
  );

const executeDisablePack = async (interaction) => {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
  }

  const packName = interaction.options.getString("pack");
  const packMeta = clubPacks.getPackMeta(packName);
  const packClubs = clubPacks.getPackClubs(packName);

  if (!packMeta || !packClubs?.length) {
    return interaction.reply({ content: `No encontre el pack **${packName}**.`, flags: 64 });
  }

  const cfg = readConfig();
  const users = readUsers();
  const affectedMemberIds = new Set();
  const affectedMemberIdsByModality = new Map();
  const removedRoles = [];
  const removedEmojis = [];
  let usersUpdated = 0;
  let playerRolesRemoved = 0;
  const unlinkedForums = [];

  const markAffected = (userId, modality) => {
    affectedMemberIds.add(userId);
    if (!affectedMemberIdsByModality.has(modality)) affectedMemberIdsByModality.set(modality, new Set());
    affectedMemberIdsByModality.get(modality).add(userId);
  };

  if (!cfg.archivedClubs) cfg.archivedClubs = {};

  try {
    await interaction.deferReply({ ephemeral: true });

    for (const clubDef of packClubs) {
      const clubEntry = clubs.findClub(clubDef.name) || clubs.findClub(clubDef.abbr) || null;
      if (!clubEntry || !cfg.clubs?.[clubEntry.name]) continue;

      const clubCfg = cfg.clubs[clubEntry.name];
      const availableRoleEntries = Object.entries(clubCfg.roles || {})
        .map(([rawModality, roleId]) => ({
          modality: roleRegistry.normalizeModality(rawModality),
          rawModality,
          roleId
        }))
        .filter((entry) => entry.modality && entry.roleId);

      if (!cfg.archivedClubs[clubEntry.name]) {
        cfg.archivedClubs[clubEntry.name] = {
          ...clubEntry,
          archivedAt: new Date().toISOString(),
          removed: []
        };
      }

      for (const { modality, rawModality, roleId } of availableRoleEntries) {
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        const roleMembers = role ? Array.from(role.members.values()) : [];

        for (const member of roleMembers) {
          markAffected(member.id, modality);
          await member.roles.remove(roleId, `Pack ${packMeta.displayName} deshabilitado (${modality})`).catch(() => null);
        }

        for (const [userId, userData] of Object.entries(users)) {
          const hasRoleInDb = userData?.clubRoles?.[modality] === roleId;
          const hasAffiliation = userData?.clubAffiliations?.[clubEntry.name]?.modalities?.[modality]?.roleId === roleId;
          if (!hasRoleInDb && !hasAffiliation) continue;
          if (removeUserDataForRole(users, userId, clubEntry.name, modality, roleId, interaction.user.tag)) {
            usersUpdated += 1;
            markAffected(userId, modality);
          }
        }

        const playerRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, modality, "player");
        if (playerRole?.roleId) {
          const modalityAffectedIds = Array.from(affectedMemberIdsByModality.get(modality) || []);
          for (const userId of modalityAffectedIds) {
            if (userHasClubInModality(users, userId, modality)) continue;

            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!member || !member.roles.cache.has(playerRole.roleId)) continue;
            if (memberHasOtherClubRoleInModality(cfg, interaction.guild.id, modality, roleId, member)) continue;

            await member.roles.remove(
              playerRole.roleId,
              `Rol de jugador removido por deshabilitar ${clubEntry.name} (${modality})`
            ).catch(() => null);
            playerRolesRemoved += 1;
          }
        }

        const captainId = clubCfg.captains?.[rawModality] || null;
        if (captainId) {
          const captainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, modality, "captain");
          const captainMember = await interaction.guild.members.fetch(captainId).catch(() => null);
          if (captainMember && captainRole?.roleId && !userIsCaptainElsewhere(cfg, clubEntry.name, modality, captainId)) {
            await captainMember.roles.remove(captainRole.roleId, `Capitan removido por deshabilitar ${clubEntry.name} (${modality})`).catch(() => null);
            markAffected(captainId, modality);
          }
          if (clubCfg.captains) delete clubCfg.captains[rawModality];
        }

        roleRegistry.removeClubRole(cfg, interaction.guild.id, modality, roleId);

        for (const [channelId, link] of Object.entries(cfg.forumClubs || {})) {
          const sameClub = String(link.club || "").toLowerCase() === String(clubEntry.name || "").toLowerCase();
          const sameMod = roleRegistry.normalizeModality(link.modality) === modality;
          if (!sameClub || !sameMod) continue;
          delete cfg.forumClubs[channelId];
          unlinkedForums.push(channelId);
          await updateLinkedForumTemplates(interaction.guild, clubEntry.name, modality).catch(() => null);
        }

        if (cfg.roleLimits) delete cfg.roleLimits[roleId];
        if (clubCfg.roles) delete clubCfg.roles[rawModality];
        if (clubCfg.affiliations) delete clubCfg.affiliations[rawModality];

        if (role) {
          await role.delete(`Pack ${packMeta.displayName} deshabilitado (${modality})`).catch(() => null);
        }

        removedRoles.push(`${clubEntry.name} ${modality}`);
        cfg.archivedClubs[clubEntry.name].removed = cfg.archivedClubs[clubEntry.name].removed || [];
        cfg.archivedClubs[clubEntry.name].removed.push({
          modality,
          roleId,
          removedAt: new Date().toISOString(),
          by: interaction.user.tag
        });
      }

      if (clubCfg.emoji) {
        const deleted = await deleteClubEmoji(interaction.guild, clubEntry.name, clubCfg);
        if (deleted) removedEmojis.push(`${clubEntry.name}`);
        clubCfg.emoji = null;
      }

      cfg.archivedClubs[clubEntry.name] = {
        ...cfg.archivedClubs[clubEntry.name],
        ...clubEntry,
        archivedAt: cfg.archivedClubs[clubEntry.name].archivedAt || new Date().toISOString(),
        disabledAt: new Date().toISOString(),
        disabledBy: interaction.user.tag
      };

      delete cfg.clubs[clubEntry.name];
    }

    saveUsers(users);
    saveConfig(cfg);

    for (const userId of affectedMemberIds) {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      for (const [modality, ids] of affectedMemberIdsByModality.entries()) {
        if (ids.has(userId)) {
          await divisions.syncMemberDivisionRoles(interaction.guild, member, cfg, modality, { ensure: false }).catch(() => null);
        }
      }
      await nicknames.updateNickname(member).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setTitle("Pack deshabilitado")
      .setDescription(`Pack **${packMeta.displayName}** deshabilitado por completo.`)
      .addFields(
        { name: "Clubes", value: String(packClubs.length), inline: true },
        { name: "Roles eliminados", value: String(removedRoles.length), inline: true },
        { name: "Emojis eliminados", value: String(removedEmojis.length), inline: true },
        { name: "Usuarios actualizados", value: String(usersUpdated), inline: true },
        { name: "Roles jugador quitados", value: String(playerRolesRemoved), inline: true },
        { name: "Foros desvinculados", value: String(unlinkedForums.length), inline: true }
      )
      .setColor(0xe74c3c);

    const files = [];
    if (packMeta.logoPath && fs.existsSync(packMeta.logoPath)) {
      files.push(packMeta.logoPath);
      embed.setThumbnail(`attachment://${path.basename(packMeta.logoPath)}`);
    }

    return interaction.editReply({ embeds: [embed], files });
  } catch (error) {
    console.error("[deshabilitarpack] Error:", error);
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content: "Error al deshabilitar el pack." }).catch(() => null);
    }
    return interaction.reply({ content: "Error al deshabilitar el pack.", flags: 64 });
  }
};

const autocompletePack = async (interaction) => {
  try {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "pack") return;

    const cfg = readConfig();
    const options = clubPacks.getPackNames()
      .filter((name) => clubPacks.getPackClubs(name).some((club) => Object.values(cfg.clubs || {}).some((entry) => String(entry.abbr || "").toLowerCase() === String(club.abbr || "").toLowerCase() && Object.values(entry.roles || {}).some(Boolean))))
      .filter((name) => !String(focused.value || "").trim() || name.toLowerCase().includes(String(focused.value || "").toLowerCase()))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));

    await interaction.respond(options);
  } catch (error) {
    console.error("[deshabilitarpack.autocomplete] error:", error?.message || error);
    try { await interaction.respond([]); } catch (_) {}
  }
};

module.exports = {
  data: commandData,
  execute: executeDisablePack,
  autocomplete: autocompletePack,
  commandData,
  executeDisablePack,
  autocompletePack
};
