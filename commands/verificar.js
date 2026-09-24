const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { readConfig, readUsers, saveConfig, upsertUserClubAffiliation, removeUserClubAffiliation, addHistory, getUser } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const nicknames = require("../utils/nicknames");
const clubs = require("../utils/clubs");
const divisions = require("../utils/divisions");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const haxoleSupabase = require("../utils/haxoleSupabase");
const { latestExcessSignings, subcaptainTime } = require("../utils/rosterLimitPlan");

const MAX_DETAILS = 12;

const normalizeUserClubRoles = (clubRoles = {}) => {
  const out = {};
  for (const [rawModality, roleId] of Object.entries(clubRoles || {})) {
    const modality = roleRegistry.normalizeModality(rawModality);
    if (modality && roleId) out[modality] = roleId;
  }
  return out;
};

const userHasClubInModality = (cfg, userData, userId, modality) => {
  const roles = normalizeUserClubRoles(userData?.clubRoles);
  if (roles[modality]) return true;

  for (const clubEntry of Object.values(cfg.clubs || {})) {
    if (clubEntry?.captains?.[modality] === userId) return true;
  }

  for (const affiliation of Object.values(userData?.clubAffiliations || {})) {
    if (affiliation?.modalities?.[modality]?.roleId) return true;
  }

  return false;
};

const buildClubRoleIndex = (cfg) => {
  const index = {};
  for (const [clubName, clubEntry] of Object.entries(cfg.clubs || {})) {
    for (const [rawModality, roleId] of Object.entries(clubEntry?.roles || {})) {
      const modality = roleRegistry.normalizeModality(rawModality);
      if (modality && roleId) index[roleId] = { clubName, clubEntry, modality };
    }
  }
  return index;
};

const pushLimited = (arr, text) => {
  if (arr.length < MAX_DETAILS) arr.push(text);
};

module.exports = {
  data: new SlashCommandBuilder().setName("verificar").setDescription("Abre el menú de verificaciones").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo administradores.", flags: 64 });
    return interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(0x151821).setTitle("Verificar servidor").setDescription("**Roles:** revisa roles generales.\n**Clubes:** sincroniza fichajes y apodos.\n**Limites:** corrige plantillas y subcapitanes excedidos.")], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`verificar:${interaction.user.id}`).setPlaceholder("Elegí qué verificar").addOptions({ label: "Roles generales", value: "roles" }, { label: "Clubes", value: "club" }, { label: "Limites de jugadores y SC", value: "limits" }))] });
  },
  async handleSelect(interaction, [owner]) {
    if (owner !== interaction.user.id || !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo el administrador que abrió este menú.", flags: 64 });
    await interaction.deferReply({ flags: 64 });
    // The existing verification engine reads optional filters through this adapter.
    const context = Object.create(interaction);
    Object.defineProperty(context, "options", { value: { getString: () => null } });
    context.editReply = interaction.editReply.bind(interaction);
    if (interaction.values[0] === "roles") return verifyGeneralRoles(context);
    if (interaction.values[0] === "club") return verifyClub(context);
    if (interaction.values[0] === "limits") return verifyRosterLimits(context);
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "club") return;
      const options = clubs.searchClubs(focused.value)
        .slice(0, 25)
        .map((club) => ({
          name: `${club.name} (${String(club.abbr || "").toUpperCase()})`.slice(0, 100),
          value: club.name
        }));
      await interaction.respond(options);
    } catch (_) {
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};

async function verifyGeneralRoles(interaction) {
  const cfg = readConfig();
  const users = readUsers();
  const guild = interaction.guild;
  const details = [];
  const errors = [];
  const summary = {
    membersChecked: 0,
    playerRolesRemoved: 0,
    captainRolesRemoved: 0,
    subcaptainRolesRemoved: 0,
    missingRoleConfig: []
  };

  await guild.members.fetch({ force: true }).catch(() => null);

  const generalTargets = [];
  for (const modality of roleRegistry.getEnabledModalities(cfg)) {
    const playerRole = await ensureGeneralRole(interaction, cfg, modality, "player");
    const captainRole = await ensureGeneralRole(interaction, cfg, modality, "captain");
    const subcaptainRole = await ensureGeneralRole(interaction, cfg, modality, "subcaptain");
    if (playerRole?.roleId) generalTargets.push({ kind: "player", modality, roleId: playerRole.roleId });
    else summary.missingRoleConfig.push(`jugador ${modality}`);
    if (captainRole?.roleId) generalTargets.push({ kind: "captain", modality, roleId: captainRole.roleId });
    else summary.missingRoleConfig.push(`cap ${modality}`);
    if (subcaptainRole?.roleId) generalTargets.push({ kind: "subcaptain", modality, roleId: subcaptainRole.roleId });
    else summary.missingRoleConfig.push(`sc ${modality}`);
  }

  for (const member of guild.members.cache.values()) {
    summary.membersChecked += 1;
    const userData = users[member.id] || {};

    for (const target of generalTargets) {
      if (!member.roles.cache.has(target.roleId)) continue;
      if (userHasClubInModality(cfg, userData, member.id, target.modality)) continue;

      try {
        await member.roles.remove(target.roleId, `Verificacion: sin club en ${target.modality}`);
        if (target.kind === "player") summary.playerRolesRemoved += 1;
        else if (target.kind === "captain") summary.captainRolesRemoved += 1;
        else summary.subcaptainRolesRemoved += 1;
        pushLimited(details, `${member.user.tag}: ${target.kind} ${target.modality}`);
      } catch (error) {
        errors.push(`${member.user.tag} ${target.kind} ${target.modality}: ${error.code || error.message}`);
      }
    }
  }

  const lines = [
    `Miembros revisados: **${summary.membersChecked}**`,
    `Roles jugador retirados: **${summary.playerRolesRemoved}**`,
    `Roles capitan retirados: **${summary.captainRolesRemoved}**`,
    `Roles SC retirados: **${summary.subcaptainRolesRemoved}**`
  ];
  if (summary.missingRoleConfig.length) lines.push(`Roles faltantes/config: ${summary.missingRoleConfig.join(", ")}`);
  if (details.length) lines.push(`Cambios: ${details.join(" | ")}`);
  if (errors.length) lines.push(`Errores: ${errors.slice(0, 10).join(" | ")}${errors.length > 10 ? ` | y ${errors.length - 10} mas` : ""}`);

  const embed = new EmbedBuilder()
    .setTitle("Verificacion de roles generales")
    .setDescription(lines.join("\n"))
    .setColor(errors.length ? 0xf1c40f : 0x2ecc71);

  return interaction.editReply({ embeds: [embed] });
}

async function verifyAllClubs(interaction, requestedModality) {
  const cfg = readConfig();
  const users = readUsers();
  const guild = interaction.guild;
  const clubRoleIndex = buildClubRoleIndex(cfg);
  const details = [];
  const errors = [];
  const summary = {
    clubsChecked: 0,
    membersChecked: 0,
    dbUpdated: 0,
    playerRolesAdded: 0,
    conflictingClubRolesRemoved: 0,
    nicknamesUpdated: 0,
    nicknamesChecked: 0,
    missingRoles: []
  };

  await guild.members.fetch({ force: true }).catch(() => null);

  for (const clubEntry of clubs.getAllClubs()) {
    summary.clubsChecked += 1;
    const targetMembers = new Map();

    for (const [rawModality, roleId] of Object.entries(clubEntry.roles || {})) {
      const modality = roleRegistry.normalizeModality(rawModality);
      if (requestedModality && modality !== requestedModality) continue;
      if (!modality || !roleId) continue;

      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        summary.missingRoles.push(`${clubEntry.name} ${modality}`);
        continue;
      }
      for (const member of role.members.values()) {
        const key = `${member.id}:${clubEntry.name}`;
        if (!targetMembers.has(key)) targetMembers.set(key, { member, modalities: new Set() });
        targetMembers.get(key).modalities.add(modality);
      }
    }

    for (const { member, modalities } of targetMembers.values()) {
      summary.membersChecked += 1;
      for (const modality of modalities) {
        const expectedRoleId = clubs.getRoleForClub(clubEntry, modality);
        const playerRole = await divisions.getClubPlayerRole(guild, cfg, clubEntry.name, modality, { ensure: true });

        if (playerRole?.roleId && !member.roles.cache.has(playerRole.roleId)) {
          try {
            await member.roles.add(playerRole.roleId, `Verificacion de clubes ${clubEntry.name}`);
            summary.playerRolesAdded += 1;
            pushLimited(details, `${clubEntry.name}: ${member.user.tag} jugador ${modality}`);
          } catch (error) {
            errors.push(`${member.user.tag} jugador ${modality}: ${error.code || error.message}`);
          }
        }
        saveConfig(cfg);

        const conflictingRoles = Object.entries(clubRoleIndex)
          .filter(([roleId, info]) =>
            roleId !== expectedRoleId &&
            info.modality === modality &&
            member.roles.cache.has(roleId))
          .map(([roleId]) => roleId);

        if (conflictingRoles.length) {
          try {
            await member.roles.remove(conflictingRoles, `Verificacion de clubes ${clubEntry.name}`);
            summary.conflictingClubRolesRemoved += conflictingRoles.length;
            pushLimited(details, `${clubEntry.name}: ${member.user.tag} conflictos ${modality}`);
          } catch (error) {
            errors.push(`${member.user.tag} conflictos ${modality}: ${error.code || error.message}`);
          }
        }

        const userData = users[member.id] || {};
        const normalizedRoles = normalizeUserClubRoles(userData.clubRoles);
        const affiliationRole = userData.clubAffiliations?.[clubEntry.name]?.modalities?.[modality]?.roleId;
        if (normalizedRoles[modality] !== expectedRoleId || affiliationRole !== expectedRoleId) {
          upsertUserClubAffiliation(member.id, {
            club: clubEntry.name,
            abbr: clubEntry.abbr,
            modality,
            roleId: expectedRoleId,
            by: interaction.user.tag
          });
          summary.dbUpdated += 1;
        }
        await divisions.syncMemberDivisionRoles(guild, member, cfg, modality, { ensure: true });
        await updateLinkedForumTemplates(guild, clubEntry.name, modality).catch(() => null);
      }

      try {
        const before = member.displayName;
        await nicknames.updateNickname(member);
        await member.fetch(true).catch(() => {});
        summary.nicknamesChecked += 1;
        if (before !== member.displayName) summary.nicknamesUpdated += 1;
      } catch (error) {
        errors.push(`${member.user.tag} apodo: ${error.code || error.message}`);
      }
    }
  }

  const lines = [
    `Clubes revisados: **${summary.clubsChecked}**${requestedModality ? ` (${requestedModality})` : ""}`,
    `Miembros con rol de club revisados: **${summary.membersChecked}**`,
    `Base actualizada: **${summary.dbUpdated}**`,
    `Roles jugador agregados: **${summary.playerRolesAdded}**`,
    `Roles de otros clubes retirados: **${summary.conflictingClubRolesRemoved}**`,
    `Apodos corregidos: **${summary.nicknamesUpdated}/${summary.nicknamesChecked}**`
  ];
  if (summary.missingRoles.length) lines.push(`Roles faltantes: ${summary.missingRoles.slice(0, 12).join(", ")}`);
  if (details.length) lines.push(`Cambios: ${details.join(" | ")}`);
  if (errors.length) lines.push(`Errores: ${errors.slice(0, 10).join(" | ")}${errors.length > 10 ? ` | y ${errors.length - 10} mas` : ""}`);

  const embed = new EmbedBuilder()
    .setTitle("Verificacion de clubes")
    .setDescription(lines.join("\n"))
    .setColor(errors.length ? 0xf1c40f : 0x2ecc71);

  return interaction.editReply({ embeds: [embed] });
}

async function ensureGeneralRole(interaction, cfg, modality, kind) {
  const existing = roleRegistry.getGeneralRole(cfg, interaction.guild.id, modality, kind);
  if (existing?.roleId) {
    const role = interaction.guild.roles.cache.get(existing.roleId) || await interaction.guild.roles.fetch(existing.roleId).catch(() => null);
    if (role) return existing;
  }

  const prefix = kind === "player" ? "JugadorFut" : kind === "captain" ? "CapFut" : "SCFut";
  const roleName = `${prefix}${String(modality).replace(/^x/, "X").replace(/^rs-x/, "RSX")}`;
  const role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase())
    || await interaction.guild.roles.create({
      name: roleName,
      colors: { primaryColor: 0xFFFFFF },
      reason: `Rol general creado por /verificar roles para ${modality}`
    }).catch(() => null);

  if (!role) return null;
  roleRegistry.setGeneralRole(cfg, interaction.guild.id, modality, kind, { roleId: role.id, name: role.name });
  saveConfig(cfg);
  return { roleId: role.id, name: role.name };
}

async function verifyClub(interaction) {
  const clubQuery = interaction.options.getString("club");
  const requestedModality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
  if (!clubQuery) return verifyAllClubs(interaction, requestedModality);

  const clubEntry = clubs.findClub(clubQuery);
  if (!clubEntry) return interaction.editReply({ content: `No encontre el club **${clubQuery}**.` });

  const cfg = readConfig();
  const users = readUsers();
  const guild = interaction.guild;
  const clubRoleIndex = buildClubRoleIndex(cfg);
  const details = [];
  const errors = [];
  const summary = {
    membersChecked: 0,
    dbUpdated: 0,
    playerRolesAdded: 0,
    conflictingClubRolesRemoved: 0,
    nicknamesChecked: 0,
    nicknamesUpdated: 0,
    missingRoles: []
  };

  await guild.members.fetch({ force: true }).catch(() => null);

  const targetMembers = new Map();
  for (const [rawModality, roleId] of Object.entries(clubEntry.roles || {})) {
    const modality = roleRegistry.normalizeModality(rawModality);
    if (requestedModality && modality !== requestedModality) continue;
    if (!modality || !roleId) continue;

    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      summary.missingRoles.push(`${modality}: rol de club no encontrado`);
      continue;
    }
    for (const member of role.members.values()) {
      if (!targetMembers.has(member.id)) targetMembers.set(member.id, { member, modalities: new Set() });
      targetMembers.get(member.id).modalities.add(modality);
    }
  }

  for (const { member, modalities } of targetMembers.values()) {
    summary.membersChecked += 1;

    for (const modality of modalities) {
      const expectedRoleId = clubs.getRoleForClub(clubEntry, modality);
      const playerRole = await divisions.getClubPlayerRole(guild, cfg, clubEntry.name, modality, { ensure: true });

      if (playerRole?.roleId && !member.roles.cache.has(playerRole.roleId)) {
        try {
          await member.roles.add(playerRole.roleId, `Verificacion de club ${clubEntry.name}`);
          summary.playerRolesAdded += 1;
          pushLimited(details, `${member.user.tag}: jugador ${modality}`);
        } catch (error) {
          errors.push(`${member.user.tag} jugador ${modality}: ${error.code || error.message}`);
        }
      }
      saveConfig(cfg);

      const conflictingRoles = Object.entries(clubRoleIndex)
        .filter(([roleId, info]) =>
          roleId !== expectedRoleId &&
          info.modality === modality &&
          member.roles.cache.has(roleId))
        .map(([roleId]) => roleId);

      if (conflictingRoles.length) {
        try {
          await member.roles.remove(conflictingRoles, `Verificacion de club ${clubEntry.name}`);
          summary.conflictingClubRolesRemoved += conflictingRoles.length;
          pushLimited(details, `${member.user.tag}: conflictos ${modality}`);
        } catch (error) {
          errors.push(`${member.user.tag} conflictos ${modality}: ${error.code || error.message}`);
        }
      }

      const userData = users[member.id] || {};
      const normalizedRoles = normalizeUserClubRoles(userData.clubRoles);
      const affiliationRole = userData.clubAffiliations?.[clubEntry.name]?.modalities?.[modality]?.roleId;
      if (normalizedRoles[modality] !== expectedRoleId || affiliationRole !== expectedRoleId) {
        upsertUserClubAffiliation(member.id, {
          club: clubEntry.name,
          abbr: clubEntry.abbr,
          modality,
          roleId: expectedRoleId,
          by: interaction.user.tag
        });
        summary.dbUpdated += 1;
      }
      await divisions.syncMemberDivisionRoles(guild, member, cfg, modality, { ensure: true });
      await updateLinkedForumTemplates(guild, clubEntry.name, modality).catch(() => null);
    }

    try {
      const before = member.displayName;
      await nicknames.updateNickname(member);
      await member.fetch(true).catch(() => {});
      summary.nicknamesChecked += 1;
      if (before !== member.displayName) summary.nicknamesUpdated += 1;
    } catch (error) {
      errors.push(`${member.user.tag} apodo: ${error.code || error.message}`);
    }
  }

  const lines = [
    `Club: **${clubEntry.name}** (${clubEntry.abbr})`,
    `Miembros con rol de club revisados: **${summary.membersChecked}**`,
    `Base actualizada: **${summary.dbUpdated}**`,
    `Roles jugador agregados: **${summary.playerRolesAdded}**`,
    `Roles de otros clubes retirados: **${summary.conflictingClubRolesRemoved}**`,
    `Apodos corregidos: **${summary.nicknamesUpdated}/${summary.nicknamesChecked}**`
  ];
  if (summary.missingRoles.length) lines.push(`Roles faltantes: ${summary.missingRoles.join(", ")}`);
  if (details.length) lines.push(`Cambios: ${details.join(" | ")}`);
  if (errors.length) lines.push(`Errores: ${errors.slice(0, 10).join(" | ")}${errors.length > 10 ? ` | y ${errors.length - 10} mas` : ""}`);

  const embed = new EmbedBuilder()
    .setTitle("Verificacion de club")
    .setDescription(lines.join("\n"))
    .setColor(errors.length ? 0xf1c40f : 0x2ecc71);

  return interaction.editReply({ embeds: [embed] });
}

const staffStillAssigned = (cfg, userId, modality, kind) => Object.values(cfg.clubs || {}).some((club) => {
  if (kind === "captain") return String(club?.captains?.[modality] || "") === String(userId);
  return String(club?.subcaptains?.general || "") === String(userId)
    || String(club?.subcaptains?.[modality] || "") === String(userId);
});

async function removeUnusedStaffRole(guild, cfg, member, modality, kind, errors) {
  if (staffStillAssigned(cfg, member.id, modality, kind)) return;
  const roleId = roleRegistry.getGeneralRole(cfg, guild.id, modality, kind)?.roleId;
  if (!roleId || !member.roles.cache.has(roleId)) return;
  try { await member.roles.remove(roleId, `Verificacion de limite ${modality}`); }
  catch (error) { errors.push(`<@${member.id}>: no pude quitar rol ${kind} (${error.code || error.message})`); }
}

async function syncIdentityAfterLimit(guild, member, errors) {
  const user = getUser(member.id);
  let remaining = null;
  for (const [clubName, entry] of Object.entries(user.clubAffiliations || {})) {
    for (const [modality, affiliation] of Object.entries(entry?.modalities || {})) {
      if (affiliation?.roleId) { remaining = { clubName, modality }; break; }
    }
    if (remaining) break;
  }
  try {
    const identity = {
      guildId: guild.id, discordUserId: member.id, discordUsername: member.user.tag,
      discordAvatarUrl: member.displayAvatarURL({ size: 128 }), haxballName: member.displayName,
      source: "verificar_limites"
    };
    if (remaining) {
      const modalityRow = await haxoleSupabase.getModalidadRow(remaining.modality);
      await haxoleSupabase.upsertPlayerIdentity({ ...identity,
        clubId: await haxoleSupabase.getClubIdByName(remaining.clubName), clubName: remaining.clubName,
        modalidadId: modalityRow?.id || null, modalidadName: remaining.modality });
    } else await haxoleSupabase.upsertPlayerIdentity({ ...identity, clearCurrentClub: true, clearCurrentModality: true });
  } catch (error) { errors.push(`<@${member.id}>: no pude sincronizar perfil web (${error.message})`); }
}

async function verifyRosterLimits(interaction) {
  const guild = interaction.guild;
  const cfg = readConfig();
  const users = readUsers(guild.id);
  const details = [];
  const errors = [];
  const touched = new Map();
  const summary = { checked: 0, exceeded: 0, playersRemoved: 0, scRemoved: 0 };
  let allMembers;
  try {
    allMembers = await guild.members.fetch({ force: true, time: 30000 });
    if (!allMembers?.size || (guild.memberCount && allMembers.size < guild.memberCount)) {
      throw new Error(`lista incompleta (${allMembers?.size || 0}/${guild.memberCount || "?"})`);
    }
  } catch (error) {
    return interaction.editReply({ content: `No corregi ningun limite: no pude obtener la lista completa de miembros (${error.message}). Reintenta cuando Discord responda.` });
  }

  for (const [clubName, club] of Object.entries(cfg.clubs || {})) {
    for (const [rawModality, roleId] of Object.entries(club?.roles || {})) {
      const modality = roleRegistry.normalizeModality(rawModality);
      if (!modality || !roleId) continue;
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) { errors.push(`${clubName} ${modality}: rol no encontrado`); continue; }
      summary.checked += 1;
      const members = Array.from(allMembers.values()).filter((member) => member.roles.cache.has(roleId));
      const cancelledIds = new Set();
      const limit = Number(cfg.roleLimits?.[roleId] ?? cfg.roleLimits?.[modality]);
      if (Number.isInteger(limit) && limit > 0 && members.length > limit) {
        summary.exceeded += 1;
        const plan = latestExcessSignings(members, users, clubName, modality, limit);
        if (plan.undated.length) {
          errors.push(`${clubName} ${modality}: ${members.length}/${limit}; faltan fechas de fichaje (${plan.undated.length}). No se cancelo a nadie al azar.`);
        } else if (plan.ambiguous) {
          errors.push(`${clubName} ${modality}: ${members.length}/${limit}; dos fichajes tienen la misma fecha en el corte. No se cancelo a nadie al azar.`);
        } else {
          for (const candidate of plan.selected) {
            let member;
            try {
              member = await guild.members.fetch({ user: candidate.id, force: true });
              if (!member?.roles.cache.has(roleId)) continue;
              await member.roles.remove(roleId, `Exceso de cupo ${clubName} ${modality} (${members.length}/${limit})`);
            } catch (error) { errors.push(`${clubName} ${modality} <@${candidate.id}>: ${error.code || error.message}`); continue; }

            cancelledIds.add(member.id);
            try { removeUserClubAffiliation(member.id, { club: clubName, modality, roleId }); }
            catch (error) { errors.push(`<@${member.id}>: no pude actualizar su fichaje (${error.message})`); }
            try { addHistory(member.id, "CANCELAR_LIMITE", { club: clubName, modality, by: interaction.user.tag }); }
            catch (error) { errors.push(`<@${member.id}>: no pude guardar el historial (${error.message})`); }
            if (String(club.captains?.[modality] || "") === String(member.id)) delete club.captains[modality];
            if (String(club.subcaptains?.[modality] || "") === String(member.id)) delete club.subcaptains[modality];
            const removedGeneralSC = String(club.subcaptains?.general || "") === String(member.id);
            if (removedGeneralSC) delete club.subcaptains.general;
            saveConfig(cfg);
            await removeUnusedStaffRole(guild, cfg, member, modality, "captain", errors);
            await removeUnusedStaffRole(guild, cfg, member, modality, "subcaptain", errors);
            if (removedGeneralSC) {
              for (const otherRawModality of Object.keys(club.roles || {})) {
                const otherModality = roleRegistry.normalizeModality(otherRawModality);
                if (!otherModality || otherModality === modality) continue;
                await removeUnusedStaffRole(guild, cfg, member, otherModality, "subcaptain", errors);
                touched.set(`${clubName}:${otherModality}`, { clubName, modality: otherModality });
              }
            }
            await divisions.syncMemberDivisionRoles(guild, member, cfg, modality, { ensure: false }).catch((error) => errors.push(`<@${member.id}>: ${error.message}`));
            await syncIdentityAfterLimit(guild, member, errors);
            if (cfg.automation?.autoNicknames !== false) await nicknames.updateNickname(member).catch(() => null);
            summary.playersRemoved += 1;
            pushLimited(details, `${clubName} ${modality}: <@${member.id}> (fichaje reciente)`);
            touched.set(`${clubName}:${modality}`, { clubName, modality });
          }
        }
      }

      const scLimit = Number(cfg.subcaptainLimits?.[modality] ?? cfg.subcaptainLimit ?? 1);
      if (!Number.isInteger(scLimit) || scLimit <= 0) continue;
      const scIds = [...new Set([club.subcaptains?.general, club.subcaptains?.[modality]].filter(Boolean))]
        .filter((id) => !cancelledIds.has(id) && allMembers.get(id)?.roles.cache.has(roleId));
      if (scIds.length <= scLimit) continue;
      summary.exceeded += 1;
      const ranked = scIds.map((id) => ({ id, at: subcaptainTime(users[id], clubName, modality) }));
      if (ranked.some((item) => item.at === null)) {
        errors.push(`${clubName} ${modality}: ${scIds.length}/${scLimit} SC; faltan fechas de asignacion. No se quito ningun SC al azar.`);
        continue;
      }
      ranked.sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id)));
      const scExcess = scIds.length - scLimit;
      if (ranked[scExcess - 1]?.at === ranked[scExcess]?.at) {
        errors.push(`${clubName} ${modality}: SC con la misma fecha de asignacion. No se quito ninguno al azar.`);
        continue;
      }
      for (const { id } of ranked.slice(0, scExcess)) {
        const removedGeneralSC = String(club.subcaptains?.general || "") === String(id);
        if (removedGeneralSC) {
          delete club.subcaptains.general;
          for (const mod of Object.keys(club.roles || {})) touched.set(`${clubName}:${mod}`, { clubName, modality: mod });
        }
        if (String(club.subcaptains?.[modality] || "") === String(id)) delete club.subcaptains[modality];
        saveConfig(cfg);
        const member = allMembers.get(id);
        await removeUnusedStaffRole(guild, cfg, member, modality, "subcaptain", errors);
        if (removedGeneralSC) {
          for (const otherRawModality of Object.keys(club.roles || {})) {
            const otherModality = roleRegistry.normalizeModality(otherRawModality);
            if (otherModality && otherModality !== modality) await removeUnusedStaffRole(guild, cfg, member, otherModality, "subcaptain", errors);
          }
        }
        try { addHistory(id, "SC_REMOVED_LIMIT", { club: clubName, modality, by: interaction.user.tag }); }
        catch (error) { errors.push(`<@${id}>: no pude guardar el historial SC (${error.message})`); }
        summary.scRemoved += 1;
        pushLimited(details, `${clubName} ${modality}: SC <@${id}> retirado`);
        touched.set(`${clubName}:${modality}`, { clubName, modality });
      }
    }
  }

  for (const { clubName, modality } of touched.values()) {
    await updateLinkedForumTemplates(guild, clubName, modality).catch((error) => errors.push(`${clubName} ${modality}: plantilla no actualizada (${error.message})`));
  }
  const lines = [
    `Plantillas revisadas: **${summary.checked}**`,
    `Excesos detectados: **${summary.exceeded}**`,
    `Fichajes recientes cancelados: **${summary.playersRemoved}**`,
    `Asignaciones SC retiradas: **${summary.scRemoved}**`
  ];
  if (details.length) lines.push(`Cambios: ${details.join(" | ")}`);
  if (errors.length) lines.push(`Pendiente/errores: ${errors.slice(0, 8).join(" | ")}${errors.length > 8 ? ` | y ${errors.length - 8} mas` : ""}`);
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Verificacion de limites").setDescription(lines.join("\n")).setColor(errors.length ? 0xf1c40f : 0x2ecc71)] });
}
