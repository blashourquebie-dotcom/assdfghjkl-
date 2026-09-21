const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, upsertUserClubAffiliation, removeUserClubAffiliation, addHistory, getUser, getUserClubAffiliationForModality } = require("../utils/database");
const clubs = require("../utils/clubs");
const nicknames = require("../utils/nicknames");
const roleRegistry = require("../utils/roleRegistry");
const { sendCapActionAlert } = require("../utils/alerts");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const { sendTempInteractionReply } = require("../utils/tempMessage");
const divisions = require("../utils/divisions");
const haxoleSupabase = require("../utils/haxoleSupabase");

const TEMP_REPLY_MS = 10000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cedercap")
    .setDescription("Transfiere la capitania registrada a otro usuario")
    .addStringOption((opt) => opt.setName("club").setDescription("Nombre del club").setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName("modalidad").setDescription("Modalidad").setRequired(true))
    .addUserOption((opt) => opt.setName("usuario").setDescription("Nuevo capitan").setRequired(true))
    .addBooleanOption((opt) => opt.setName("cancelar").setDescription("Cancela al CAP saliente y ficha al nuevo si hace falta").setRequired(false)),

  async execute(interaction) {
    const link = readConfig().forumClubs?.[interaction.channel?.id];
    const clubQ = interaction.options.getString("club") || link?.club;
    const mod = roleRegistry.normalizeModality(interaction.options.getString("modalidad") || link?.modality);
    const usuario = interaction.options.getUser("usuario");
    const shouldCancelOutgoing = Boolean(interaction.options.getBoolean("cancelar"));
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    try {
      const cfg = readConfig();
      const clubEntry = clubs.findClub(clubQ);
      if (!clubEntry) {
        return sendTempInteractionReply(interaction, {
          content: `No encontre el club **${clubQ}**.`,
          flags: 64
        }, TEMP_REPLY_MS);
      }
      if (!mod) return interaction.reply({ content: "Modalidad invalida.", flags: 64 });

      const newCapMember = await interaction.guild.members.fetch(usuario.id);
      const currentCapId = clubEntry.captains?.[mod];
      if (String(usuario.id) === String(currentCapId)) {
        return interaction.reply({ content: "Ese usuario ya es el CAP actual. Elegi otro jugador de la plantilla.", flags: 64 });
      }

      if (!isAdmin && currentCapId !== interaction.user.id) {
        return interaction.reply({ content: "Solo el CAP actual de esta modalidad o un admin puede ceder la capitania.", flags: 64 });
      }

      const roleId = clubs.getRoleForClub(clubEntry, mod);
      if (!roleId) {
        return interaction.reply({ content: `El club **${clubEntry.name}** no tiene rol configurado para **${mod}**.`, flags: 64 });
      }

      const newCapHasClubRole = newCapMember.roles.cache.has(roleId);
      if (!shouldCancelOutgoing && !newCapHasClubRole) {
        return interaction.reply({ content: `**${usuario.tag}** no tiene el rol de **${clubEntry.name} ${mod}**. Primero debe estar fichado.`, flags: 64 });
      }

      if (shouldCancelOutgoing && !currentCapId) {
        return interaction.reply({ content: `No hay CAP actual registrado en **${clubEntry.name} ${mod}** para cancelar.`, flags: 64 });
      }

      const conflictingClubRole = roleRegistry
        .getClubRoles(cfg, interaction.guild.id, mod)
        .find((entry) => entry.roleId !== roleId && newCapMember.roles.cache.has(entry.roleId));
      if (conflictingClubRole) {
        return interaction.reply({
          content: `**${usuario.tag}** ya tiene club en **${mod}**: **${conflictingClubRole.name}**. Primero debe salir de ese club.`,
          flags: 64
        });
      }

      const oldCapMember = currentCapId
        ? await interaction.guild.members.fetch(currentCapId).catch(() => null)
        : null;

      if (shouldCancelOutgoing) {
        if (oldCapMember?.roles?.cache?.has(roleId)) {
          await oldCapMember.roles.remove(roleId, `Cancelado al ceder CAP de ${clubEntry.name} ${mod}`);
        }
        removeUserClubAffiliation(currentCapId, { club: clubEntry.name, modality: mod, roleId });
        addHistory(currentCapId, "CANCELAR_CAP_SALIENTE", { club: clubEntry.name, modality: mod, by: interaction.user.tag, newCap: usuario.id });
        const currentUserData = getUser(currentCapId);
        let remainingAffiliation = getUserClubAffiliationForModality(currentCapId, mod);
        if (!remainingAffiliation) {
          outer:
          for (const [clubName, entry] of Object.entries(currentUserData.clubAffiliations || {})) {
            for (const [nextMod, affiliation] of Object.entries(entry.modalities || {})) {
              if (!affiliation?.roleId) continue;
              remainingAffiliation = { club: clubName, modality: nextMod };
              break outer;
            }
          }
        }
        if (remainingAffiliation) {
          const modalityRow = await haxoleSupabase.getModalidadRow(remainingAffiliation.modality).catch(() => null);
          const clubId = await haxoleSupabase.getClubIdByName(remainingAffiliation.club).catch(() => null);
          await haxoleSupabase.upsertPlayerIdentity({
            guildId: interaction.guild.id,
            discordUserId: currentCapId,
            discordUsername: oldCapMember?.user?.tag || null,
            discordAvatarUrl: oldCapMember?.user?.displayAvatarURL?.({ size: 128 }) || null,
            haxballName: oldCapMember?.displayName || oldCapMember?.user?.username || oldCapMember?.user?.tag || null,
            clubId,
            clubName: remainingAffiliation.club,
            modalidadId: modalityRow?.id || null,
            modalidadName: remainingAffiliation.modality,
            source: "cedercap"
          }).catch(() => null);
        } else {
          await haxoleSupabase.upsertPlayerIdentity({
            guildId: interaction.guild.id,
            discordUserId: currentCapId,
            discordUsername: oldCapMember?.user?.tag || null,
            discordAvatarUrl: oldCapMember?.user?.displayAvatarURL?.({ size: 128 }) || null,
            haxballName: oldCapMember?.displayName || oldCapMember?.user?.username || oldCapMember?.user?.tag || null,
            clearCurrentClub: true,
            clearCurrentModality: true,
            source: "cedercap"
          }).catch(() => null);
        }
        if (oldCapMember) {
          await divisions.syncMemberDivisionRoles(interaction.guild, oldCapMember, cfg, mod, { ensure: false });
          await nicknames.updateNickname(oldCapMember).catch(() => null);
        }
      }

      if (shouldCancelOutgoing && !newCapHasClubRole) {
        await newCapMember.roles.add(roleId, `Fichado al recibir CAP de ${clubEntry.name} ${mod}`);
      }

      upsertUserClubAffiliation(newCapMember.id, {
        club: clubEntry.name,
        abbr: clubEntry.abbr,
        modality: mod,
        roleId,
        by: interaction.user.tag
      });
      const modalityRow = await haxoleSupabase.getModalidadRow(mod).catch(() => null);
      await haxoleSupabase.upsertPlayerIdentity({
        guildId: interaction.guild.id,
        discordUserId: newCapMember.id,
        discordUsername: newCapMember.user.tag,
        discordAvatarUrl: newCapMember.displayAvatarURL({ size: 128 }),
        haxballName: newCapMember.displayName,
        clubId: await haxoleSupabase.getClubIdByName(clubEntry.name).catch(() => null),
        clubName: clubEntry.name,
        modalidadId: modalityRow?.id || null,
        modalidadName: mod,
        source: "cedercap"
      }).catch(() => null);
      addHistory(newCapMember.id, "CEDERCAP_RECIBIDA", {
        club: clubEntry.name,
        modality: mod,
        by: interaction.user.tag,
        cancelledOutgoing: shouldCancelOutgoing
      });
      await divisions.syncMemberDivisionRoles(interaction.guild, newCapMember, cfg, mod, { ensure: true });
      await nicknames.updateNickname(newCapMember).catch(() => null);

      cfg.clubs[clubEntry.name].captains = cfg.clubs[clubEntry.name].captains || {};
      if (String(cfg.clubs[clubEntry.name].subcaptains?.general || "") === String(usuario.id)) {
        delete cfg.clubs[clubEntry.name].subcaptains.general;
      }
      if (String(cfg.clubs[clubEntry.name].subcaptains?.[mod] || "") === String(usuario.id)) {
        delete cfg.clubs[clubEntry.name].subcaptains[mod];
      }
      cfg.clubs[clubEntry.name].captains[mod] = usuario.id;
      saveConfig(cfg);

      const captainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "captain");
      if (captainRole?.roleId && !newCapMember.roles.cache.has(captainRole.roleId)) {
        await newCapMember.roles.add(captainRole.roleId, "CAP transferido por /cedercap").catch(() => null);
      }
      const subcaptainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "subcaptain");
      if (subcaptainRole?.roleId && newCapMember.roles.cache.has(subcaptainRole.roleId)) {
        await newCapMember.roles.remove(subcaptainRole.roleId, "CAP transferido por /cedercap").catch(() => null);
      }
      if (currentCapId && currentCapId !== usuario.id && captainRole?.roleId) {
        const stillCaptainElsewhere = Object.entries(cfg.clubs || {}).some(([otherClub, otherEntry]) => {
          if (otherClub === clubEntry.name) return false;
          return String(otherEntry?.captains?.[mod] || "") === String(currentCapId);
        });
        if (oldCapMember && !stillCaptainElsewhere) {
          await oldCapMember.roles.remove(captainRole.roleId, "CAP cedido a otro usuario").catch(() => null);
        }
      }
      await sendCapActionAlert(interaction, {
        action: "Cesion de CAP",
        club: clubEntry.name,
        modality: mod,
        targets: [usuario.id],
        details: [
          `**CAP anterior:** <@${currentCapId || interaction.user.id}>`,
          shouldCancelOutgoing ? "**Cancelacion incluida:** si" : null
        ].filter(Boolean).join("\n")
      }).catch(() => null);

      return sendTempInteractionReply(interaction, {
        content: [
          "✅ Capitania transferida.",
          `**Club:** ${clubEntry.name} (${mod})`,
          `**Nuevo CAP:** ${usuario.tag}`,
          shouldCancelOutgoing && oldCapMember ? `**Cancelado:** ${oldCapMember.user.tag}` : null,
          shouldCancelOutgoing && !newCapHasClubRole ? "**Nuevo CAP fichado automaticamente.**" : null
        ].filter(Boolean).join("\n"),
        flags: 64
      }, TEMP_REPLY_MS);

      void updateLinkedForumTemplates(interaction.guild, clubEntry.name, mod).catch(() => null);
    } catch (err) {
      console.error("[cedercap] Error:", err);
      return interaction.reply({ content: "Ocurrio un error al transferir la capitania.", flags: 64 });
    }
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
      console.error("[cedercap.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
