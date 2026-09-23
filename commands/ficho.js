const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, readUsers, upsertUserClubAffiliation, addHistory } = require("../utils/database");
const clubs = require("../utils/clubs");
const validators = require("../utils/validators");
const nicknames = require("../utils/nicknames");
const roleRegistry = require("../utils/roleRegistry");
const { updateLinkedForumTemplates, ensureGuildMembersLoaded } = require("../utils/plantillas");
const { sendAlert, sendCapActionAlert } = require("../utils/alerts");
const market = require("../utils/market");
const { sendTempInteractionReply } = require("../utils/tempMessage");
const { isCaptain, isClubStaff } = require("../utils/clubPermissions");
const { CHECK_EMOJI, createPendingTransfer } = require("../utils/transfers");
const divisions = require("../utils/divisions");
const { ensureClubRoleForModality } = require("../utils/clubRoleRecovery");
const { ensureGeneralRolesForModality } = require("../utils/serverSetup");
const haxoleSupabase = require("../utils/haxoleSupabase");

const TEMP_REPLY_MS = 10000;

const parseUserIds = (raw) => Array.from(new Set(String(raw || "").split(/[\s,]+/).map((part) => {
  const mention = part.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  return /^\d{15,25}$/.test(part) ? part : null;
}).filter(Boolean)));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ficho")
    .setDescription("Ficha usuarios desde un foro/canal vinculado")
    .addStringOption((o) => o.setName("usuarios").setDescription("Menciones o IDs separados por coma").setRequired(true)),

  async execute(interaction) {
    const cfg = readConfig();
    const link = cfg.forumClubs?.[interaction.channel.id] || cfg.forumClubs?.[interaction.channel.parentId];
    if (!link) {
      return interaction.reply({ content: "Este canal no esta vinculado. Usa `/foroclub` primero.", flags: 64 });
    }

    const clubEntry = clubs.findClub(link.club);
    const modality = roleRegistry.normalizeModality(link.modality);
    if (!clubEntry || !modality) {
      return interaction.reply({ content: "La vinculacion de este foro esta incompleta. Volve a usar `/foroclub`.", flags: 64 });
    }
    const modalityRow = await haxoleSupabase.getModalidadRow(modality).catch(() => null);

    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const isStaff = isClubStaff(cfg, clubEntry.name, modality, interaction.user.id);
    const generalRoles = roleRegistry.getGeneralRoles(cfg, interaction.guild.id, modality);
    const hasCaptainRole = Boolean(generalRoles.captainRoleId && interaction.member?.roles?.cache?.has(generalRoles.captainRoleId));
    const hasSubcaptainRole = Boolean(generalRoles.subcaptainRoleId && interaction.member?.roles?.cache?.has(generalRoles.subcaptainRoleId));
    const canFichar = isAdmin || isStaff || hasCaptainRole || hasSubcaptainRole;
    if (!canFichar) {
      await sendAlert(interaction.guild, [
        "**Intento no permitido de fichaje**",
        `**Usuario:** ${interaction.user.tag} (<@${interaction.user.id}>)`,
        `**Club:** ${clubEntry.name} (${modality})`,
        `**Canal:** <#${interaction.channel.id}>`
      ].join("\n"));
      return interaction.reply({
        content: "No tenes permiso para fichar en este foro. Solo puede hacerlo el CAP/SC vinculado a este club/modalidad o un admin.",
        flags: 64
      });
    }

    await interaction.deferReply({ flags: 64 });

    const clubRoleRecovery = await ensureClubRoleForModality(interaction.guild, cfg, clubEntry, modality, {
      reason: `Recuperacion por /ficho para ${clubEntry.name} ${modality}`
    }).catch(() => null);
    const roleId = clubs.getRoleForClub(clubEntry, modality) || clubRoleRecovery?.role?.id || null;
    if (!roleId) return interaction.editReply({ content: `No pude recuperar el rol de club de **${clubEntry.name}** para **${modality}**.` });

    const autoNicknames = cfg.automation?.autoNicknames !== false;

    const userIds = parseUserIds(interaction.options.getString("usuarios"));
    if (!userIds.length) {
      return sendTempInteractionReply(interaction, {
        content: "No se encontro ningun usuario valido. Menciona usuarios o pega IDs separados por coma.",
        flags: 64
      }, TEMP_REPLY_MS);
    }

    const fetchedMembers = await Promise.all(userIds.map(async (userId) => {
      const member = interaction.guild.members.cache.get(userId)
        || await interaction.guild.members.fetch(userId).catch(() => null);
      return [userId, member];
    }));
    const users = readUsers(interaction.guild.id);
    const membersById = new Map();
    const missingIds = [];
    for (const [userId, member] of fetchedMembers) {
      if (member) membersById.set(userId, member);
      else missingIds.push(userId);
    }

    const clubRolesInModality = roleRegistry.getClubRoles(cfg, interaction.guild.id, modality);
    const getConflict = (member) => {
      const userData = users[member.id] || {};
      const dbConflict = Object.entries(userData.clubAffiliations || {}).find(([clubName, entry]) =>
        clubName !== clubEntry.name && Boolean(entry?.modalities?.[modality]?.roleId)
      );
      if (dbConflict) {
        return {
          name: dbConflict[0],
          roleId: dbConflict[1]?.modalities?.[modality]?.roleId || null,
          source: "db"
        };
      }

      return clubRolesInModality.find((entry) => entry.roleId !== roleId && member.roles.cache.has(entry.roleId)) || null;
    };

    const newSigningCount = Array.from(membersById.values())
      .filter((member) => !member.roles.cache.has(roleId) && !getConflict(member))
      .length;
    const roleLimit = validators.getRoleLimit(roleId, modality);
    if (roleLimit && newSigningCount > 0) {
      try { await ensureGuildMembersLoaded(interaction.guild); }
      catch (error) {
        return interaction.editReply({ content: 'No pude consultar la lista completa del rol. Revisá el intent de miembros de Discord y volvé a intentar.' });
      }
      const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
      if (!role) return interaction.editReply({ content: 'No pude consultar el rol del club. Volvé a intentar.' });
      const currentCount = role.members.size;
      if (currentCount + newSigningCount > roleLimit) {
        return sendTempInteractionReply(interaction, {
          content: [
            `**No se puede completar el fichaje en ${clubEntry.name} ${modality}.**`,
            "",
            `La plantilla tiene **${currentCount}/${roleLimit}** lugares ocupados y estas intentando sumar **${newSigningCount}** jugador(es).`,
            `Con este comando quedaria en **${currentCount + newSigningCount}/${roleLimit}**, pasando el limite permitido.`,
            "",
            "Elegí a quienes vas a fichar ahora o baja jugadores de la plantilla antes de volver a intentarlo."
          ].join("\n"),
          flags: 64
        }, TEMP_REPLY_MS);
      }
    }

    const marketCheck = newSigningCount > 0
      ? market.checkSigningAllowance({
        club: clubEntry.name,
        modality,
        amount: newSigningCount,
        guildId: interaction.guild.id,
        actorId: interaction.user.id,
        guildOwnerId: interaction.guild.ownerId,
        confirmationKey: interaction.sourceMessage?.content || `ficho:${clubEntry.name}:${modality}:${userIds.join(",")}`
      })
      : { ok: true };
    if (!marketCheck.ok) return interaction.reply({ content: marketCheck.message, flags: 64 });

    const lines = [];
    const appliedIds = [];
    const touchedModalities = new Set();
    for (const userId of missingIds) {
      lines.push(`Aviso: <@${userId}> no encontrado.`);
    }

    for (const userId of userIds) {
      const member = membersById.get(userId);
      if (!member) continue;

      const conflict = getConflict(member);
      const userData = users[member.id] || {};
      const currentAffiliation = userData.clubAffiliations?.[clubEntry.name]?.modalities?.[modality] || null;

      if (conflict) {
        const captainConflict = isCaptain(cfg, conflict.name, modality, member.id);
        const prompt = await createPendingTransfer(interaction, member, {
          fromClub: conflict.name,
          fromRoleId: conflict.roleId,
          toClub: clubEntry.name,
          toRoleId: roleId,
          modality,
          isCaptainTransfer: captainConflict
        });
        lines.push(captainConflict
          ? `Pendiente: **${member.user.tag}** ya es CAP en **${conflict.name} ${modality}**. Tiene que ceder capitania y tocar **Aceptar**${prompt?.url ? ` aca: ${prompt.url}` : ""}.`
          : `Pendiente: **${member.user.tag}** ya esta en **${conflict.name} ${modality}**. Le mande aviso por MD y puede aprobar el cambio con el boton **Aceptar**${prompt?.url ? ` aca: ${prompt.url}` : ""}.`
        );
        continue;
      }

      const alreadyHadRole = member.roles.cache.has(roleId);
      if (!alreadyHadRole) {
        await member.roles.add(roleId, `Fichado por ${interaction.user.tag} via !ficho`);
      }

      upsertUserClubAffiliation(member.id, {
        club: clubEntry.name,
        abbr: clubEntry.abbr,
        modality,
        roleId,
        by: interaction.user.tag
      });

      if (!alreadyHadRole || !currentAffiliation) {
        addHistory(member.id, "FICHO", { modality, club: clubEntry.name, by: interaction.user.tag });
      }

      let playerRole = await divisions.getClubPlayerRole(interaction.guild, cfg, clubEntry.name, modality, { ensure: true });
      if (!playerRole?.roleId) {
        await ensureGeneralRolesForModality(interaction.guild, cfg, interaction.guild.id, modality, {
          reason: `Recuperacion de roles base por /ficho (${clubEntry.name} ${modality})`,
          ensureSecondDivision: true,
          keepClubRolesBelowPlayer: cfg.automation?.clubRolesBelowPlayer !== false
        }).catch(() => null);
        playerRole = await divisions.getClubPlayerRole(interaction.guild, cfg, clubEntry.name, modality, { ensure: true });
      }
      if (playerRole?.roleId && !member.roles.cache.has(playerRole.roleId)) {
        await member.roles.add(playerRole.roleId, "Rol jugador/division agregado via !ficho").catch(() => null);
      }
      await divisions.syncMemberDivisionRoles(interaction.guild, member, cfg, modality, { ensure: true });
        await haxoleSupabase.upsertPlayerIdentity({
          guildId: interaction.guild.id,
          discordUserId: member.id,
        discordUsername: member.user.tag,
        discordAvatarUrl: member.displayAvatarURL({ size: 128 }),
        haxballName: member.displayName,
        clubId: await haxoleSupabase.getClubIdByName(clubEntry.name).catch(() => null),
        clubName: clubEntry.name,
        modalidadId: modalityRow?.id || null,
          modalidadName: modality,
          source: "ficho"
        }).catch(() => null);
        if (autoNicknames) void nicknames.updateNickname(member).catch(() => null);
        lines.push(alreadyHadRole
          ? `Aviso: **${member.user.tag}** ya estaba fichado en **${clubEntry.name} ${modality}**. Plantilla sincronizada.`
          : `${CHECK_EMOJI} **${member.user.tag}** fichado en **${clubEntry.name} ${modality}**.`);
        if (!alreadyHadRole) appliedIds.push(member.id);
        touchedModalities.add(modality);
      }

      if (appliedIds.length) {
        market.registerSignings({ club: clubEntry.name, modality, amount: appliedIds.length });
        void sendCapActionAlert(interaction, {
        action: "Fichaje",
        club: clubEntry.name,
        modality,
        targets: appliedIds
        }).catch(() => null);
      }

    for (const mod of touchedModalities) {
      await updateLinkedForumTemplates(interaction.guild, clubEntry.name, mod);
    }

      const response = await sendTempInteractionReply(interaction, {
        content: [`**Fichaje en ${clubEntry.name} ${modality}**`, lines.join("\n")].join("\n"),
      flags: 64
    }, TEMP_REPLY_MS);

    return response;
  }
};
