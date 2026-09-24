const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig, readUsers, saveUsers } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const nicknames = require("../utils/nicknames");
const divisions = require("../utils/divisions");

const parseRequestedModalities = (raw, available) => {
  const availableMods = Array.from(new Set(available.map(roleRegistry.normalizeModality).filter(Boolean)));
  const value = String(raw || "").trim().toLowerCase();

  if (!value || value === "all" || value === "todo" || value === "todos" || value === "todas") {
    return { modalities: availableMods, invalid: [] };
  }

  const parsed = roleRegistry.parseModalitiesInput(value);
  const notInClub = parsed.modalities.filter((mod) => !availableMods.includes(mod));
  return {
    modalities: parsed.modalities.filter((mod) => availableMods.includes(mod)),
    invalid: [...parsed.invalid, ...notInClub]
  };
};

const commandData = (name = "deshabilitarclub") =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription("Deshabilita un club o modalidades")
    .addStringOption((opt) =>
      opt
        .setName("club")
        .setDescription("Nombre o abreviacion del club")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("modalidades")
        .setDescription("Opcional. Ej: x3,x4. Si no se indica, deshabilita todas")
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt.setName("sancionar").setDescription("Marcar la baja como sanción (por defecto, no)").setRequired(false)
    );

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
      action: "DESHABILITARCLUB",
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

const executeDisableClub = async (interaction) => {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
  }

  const clubQuery = interaction.options.getString("club");
  const modalitiesRaw = interaction.options.getString("modalidades");
  const sancionar = interaction.options.getBoolean?.("sancionar") === true;

  console.log(`[deshabilitarclub] Deshabilitando club ${clubQuery}, modalidades: ${modalitiesRaw || "todas"}`);

  const cfg = readConfig();
  const users = readUsers();
  const clubEntry = clubs.findClub(clubQuery);

  if (!clubEntry || !cfg.clubs?.[clubEntry.name]) {
    return interaction.reply({ content: `Club **${clubQuery}** no encontrado.`, flags: 64 });
  }

  const clubCfg = cfg.clubs[clubEntry.name];
  const availableRoleEntries = Object.entries(clubCfg.roles || {})
    .map(([rawModality, roleId]) => ({
      modality: roleRegistry.normalizeModality(rawModality),
      rawModality,
      roleId
    }))
    .filter((entry) => entry.modality && entry.roleId);

  const parsed = parseRequestedModalities(modalitiesRaw, availableRoleEntries.map((entry) => entry.modality));
  if (parsed.invalid.length) {
    return interaction.reply({
      content: `Modalidades invalidas o no vinculadas al club: ${parsed.invalid.join(", ")}`,
      flags: 64
    });
  }
  if (!parsed.modalities.length) {
    return interaction.reply({ content: `El club **${clubEntry.name}** no tiene modalidades para deshabilitar.`, flags: 64 });
  }

  const selected = availableRoleEntries.filter((entry) => parsed.modalities.includes(entry.modality));
  const affectedMemberIds = new Set();
  const affectedMemberIdsByModality = new Map();
  const removedRoles = [];
  let usersUpdated = 0;
  let playerRolesRemoved = 0;
  const unlinkedForums = [];

  const markAffected = (userId, modality) => {
    affectedMemberIds.add(userId);
    if (!affectedMemberIdsByModality.has(modality)) affectedMemberIdsByModality.set(modality, new Set());
    affectedMemberIdsByModality.get(modality).add(userId);
  };

  try {
    if (!cfg.archivedClubs) cfg.archivedClubs = {};
    if (!cfg.archivedClubs[clubEntry.name]) {
      cfg.archivedClubs[clubEntry.name] = {
        ...clubEntry,
        archivedAt: new Date().toISOString(),
        removed: []
      };
    }

    for (const { modality, rawModality, roleId } of selected) {
      const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
      const roleMembers = role ? Array.from(role.members.values()) : [];

      for (const member of roleMembers) {
        markAffected(member.id, modality);
        await member.roles.remove(roleId, `Club ${clubEntry.name} deshabilitado (${modality})`).catch(() => null);
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

      const captainId = clubCfg.captains?.[modality] || null;
      if (captainId) {
        const captainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, modality, "captain");
        const captainMember = await interaction.guild.members.fetch(captainId).catch(() => null);
        if (captainMember && captainRole?.roleId && !userIsCaptainElsewhere(cfg, clubEntry.name, modality, captainId)) {
          await captainMember.roles.remove(captainRole.roleId, `Capitan removido por deshabilitar ${clubEntry.name} (${modality})`).catch(() => null);
          markAffected(captainId, modality);
        }
        if (clubCfg.captains) delete clubCfg.captains[modality];
      }

      roleRegistry.removeClubRole(cfg, interaction.guild.id, modality, roleId);
      for (const [channelId, link] of Object.entries(cfg.forumClubs || {})) {
        const sameClub = String(link.club || "").toLowerCase() === String(clubEntry.name || "").toLowerCase();
        const sameMod = roleRegistry.normalizeModality(link.modality) === modality;
        if (!sameClub || !sameMod) continue;
        delete cfg.forumClubs[channelId];
        unlinkedForums.push(channelId);
      }
      if (cfg.roleLimits) delete cfg.roleLimits[roleId];
      if (clubCfg.roles) delete clubCfg.roles[rawModality];
      if (clubCfg.affiliations) delete clubCfg.affiliations[rawModality];

      if (role) {
        await role.delete(`Club ${clubEntry.name} deshabilitado (${modality})`).catch(() => null);
      }

      removedRoles.push(`${modality}: ${roleId}`);
      cfg.archivedClubs[clubEntry.name].removed = cfg.archivedClubs[clubEntry.name].removed || [];
      cfg.archivedClubs[clubEntry.name].removed.push({
        modality,
        roleId,
        removedAt: new Date().toISOString(),
        by: interaction.user.tag
      });
    }

    const remainingRoles = Object.keys(clubCfg.roles || {});
    const removedEverything = remainingRoles.length === 0;
    if (sancionar) {
      cfg.archivedClubs[clubEntry.name].sanctioned = true;
      cfg.archivedClubs[clubEntry.name].sanctionedAt = new Date().toISOString();
      cfg.archivedClubs[clubEntry.name].sanctionedBy = interaction.user.id;
      clubCfg.sanctioned = true;
      clubCfg.sanctionedAt = cfg.archivedClubs[clubEntry.name].sanctionedAt;
      clubCfg.sanctionedBy = interaction.user.id;
    }
    let emojiStatus = "se conserva";
    if (removedEverything) {
      const emojiId = String(clubCfg.emoji || '').match(/<a?:[^:>]+:(\d{15,25})>/)?.[1];
      const shared = emojiId && Object.entries(cfg.clubs || {}).some(([name, entry]) =>
        name !== clubEntry.name && String(entry?.emoji || '').includes(`:${emojiId}>`));
      if (emojiId && !shared) {
        const emoji = interaction.guild.emojis.cache.get(emojiId) || await interaction.guild.emojis.fetch(emojiId).catch(() => null);
        if (emoji) {
          try { await emoji.delete(`Club ${clubEntry.name} deshabilitado en todas las modalidades`); emojiStatus = "eliminado"; }
          catch (error) { emojiStatus = "error al eliminar"; console.error(`[deshabilitarclub] No se pudo eliminar el emoji de ${clubEntry.name}:`, error); }
        }
        else emojiStatus = "ya no existe";
      }
      cfg.archivedClubs[clubEntry.name] = {
        ...cfg.archivedClubs[clubEntry.name],
        ...clubEntry,
        archivedAt: cfg.archivedClubs[clubEntry.name].archivedAt || new Date().toISOString(),
        disabledAt: new Date().toISOString(),
        disabledBy: interaction.user.tag
      };
      if (emojiStatus === "eliminado" || emojiStatus === "ya no existe") cfg.archivedClubs[clubEntry.name].emoji = null;
      delete cfg.clubs[clubEntry.name];
    } else {
      cfg.clubs[clubEntry.name] = clubCfg;
    }

    saveUsers(users);
    saveConfig(cfg);

    for (const userId of affectedMemberIds) {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        for (const [modality, ids] of affectedMemberIdsByModality.entries()) {
          if (ids.has(userId)) await divisions.syncMemberDivisionRoles(interaction.guild, member, cfg, modality, { ensure: false });
        }
        await nicknames.updateNickname(member).catch(() => null);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("Club deshabilitado")
      .setDescription(`Club **${clubEntry.name}** deshabilitado en: **${selected.map((entry) => entry.modality).join(", ")}**`)
      .addFields(
        { name: "Roles eliminados", value: removedRoles.length ? removedRoles.join("\n").slice(0, 1024) : "ninguno" },
        { name: "Usuarios actualizados", value: String(usersUpdated), inline: true },
        { name: "Roles jugador quitados", value: String(playerRolesRemoved), inline: true },
        { name: "Foros desvinculados", value: String(unlinkedForums.length), inline: true },
        { name: "Club completo", value: removedEverything ? "si" : "no", inline: true }
        ,{ name: "Emoji del servidor", value: emojiStatus, inline: true }
        ,{ name: "Sanción", value: sancionar ? "sí" : "no", inline: true }
      )
      .setColor(0xe74c3c);

    return interaction.reply({ embeds: [embed], flags: 64 });
  } catch (error) {
    console.error("[deshabilitarclub] Error:", error);
    return interaction.reply({ content: "Error al deshabilitar/deshabilitar el club.", flags: 64 });
  }
};

const autocompleteClub = async (interaction) => {
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
    console.error("[deshabilitarclub.autocomplete] error:", error?.message || error);
    try { await interaction.respond([]); } catch (_) {}
  }
};

module.exports = {
  data: commandData("deshabilitarclub"),
  execute: executeDisableClub,
  autocomplete: autocompleteClub,
  commandData,
  executeDisableClub,
  autocompleteClub
};


