const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { readConfig, readUsers, saveConfig, upsertUserClubAffiliation } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const nicknames = require("../utils/nicknames");
const clubs = require("../utils/clubs");
const divisions = require("../utils/divisions");
const { updateLinkedForumTemplates } = require("../utils/plantillas");

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
    return interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(0x151821).setTitle("Verificar servidor").setDescription("**Roles:** revisa roles generales y retira los que no correspondan.\n**Clubes:** sincroniza roles, fichajes y apodos de los clubes.")], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`verificar:${interaction.user.id}`).setPlaceholder("Elegí qué verificar").addOptions({ label: "Roles generales", value: "roles" }, { label: "Clubes", value: "club" }))] });
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
