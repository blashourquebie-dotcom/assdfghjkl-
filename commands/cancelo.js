const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, removeUserClubAffiliation, addHistory, getUser, getUserClubAffiliationForModality } = require("../utils/database");
const clubs = require("../utils/clubs");
const nicknames = require("../utils/nicknames");
const roleRegistry = require("../utils/roleRegistry");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const { sendCapActionAlert } = require("../utils/alerts");
const { sendTempInteractionReply } = require("../utils/tempMessage");
const { isClubStaff } = require("../utils/clubPermissions");
const divisions = require("../utils/divisions");
const haxoleSupabase = require("../utils/haxoleSupabase");

const TEMP_REPLY_MS = 10000;

const parseUserIds = (raw) => Array.from(new Set(
  String(raw || "")
    .split(/[\s,]+/)
    .map((part) => {
      const mention = part.match(/^<@!?(\d+)>$/);
      if (mention) return mention[1];
      return /^\d{15,25}$/.test(part) ? part : null;
    })
    .filter(Boolean)
));

const resolveModalities = (clubEntry, raw) => {
  const value = String(raw || "all").toLowerCase().trim();
  if (["all", "todo", "todos", "todas"].includes(value)) {
    return Object.keys(clubEntry.roles || {}).map(roleRegistry.normalizeModality).filter(Boolean);
  }
  return roleRegistry.parseModalitiesInput(value).modalities;
};

const shouldAutoNicknames = (cfg) => cfg.automation?.autoNicknames !== false;

const stillHasCaptainElsewhere = (cfg, clubName, modality, userId) =>
  Object.entries(cfg.clubs || {}).some(([otherClub, clubData]) =>
    otherClub !== clubName && String(clubData?.captains?.[modality] || "") === String(userId)
  );

const stillHasSubElsewhere = (cfg, clubName, modality, userId) =>
  Object.entries(cfg.clubs || {}).some(([otherClub, clubData]) =>
    otherClub !== clubName && (
      String(clubData?.subcaptains?.general || "") === String(userId) ||
      String(clubData?.subcaptains?.[modality] || "") === String(userId)
    )
  );

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cancelo")
    .setDescription("Cancela usuarios desde un foro/canal vinculado")
    .addStringOption((o) => o.setName("usuarios").setDescription("Menciones o IDs separados por coma").setRequired(false))
    .addStringOption((o) => o.setName("club").setDescription("Nombre o abreviacion del club").setRequired(false).setAutocomplete(true))
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad o all").setRequired(false)),

  async execute(interaction) {
    const cfg = readConfig();
    const link = cfg.forumClubs?.[interaction.channel.id] || cfg.forumClubs?.[interaction.channel.parentId];
    if (!link) return interaction.reply({ content: "Este canal no esta vinculado. Usa `/foroclub` primero.", flags: 64 });

    const clubEntry = clubs.findClub(link.club);
    const modality = roleRegistry.normalizeModality(link.modality);
    if (!clubEntry || !modality) {
      return interaction.reply({ content: "La vinculacion de este foro esta incompleta. Volve a usar `/foroclub`.", flags: 64 });
    }

    const clubQ = interaction.options.getString("club") || clubEntry.name;
    const modalRaw = interaction.options.getString("modalidad") || "all";
    const selectedClub = clubs.findClub(clubQ) || clubEntry;
    const modalities = resolveModalities(selectedClub, modalRaw);
    if (!modalities.length) return interaction.reply({ content: "Modalidad invalida o no vinculada al club.", flags: 64 });

    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const isStaff = modalities.some((mod) => isClubStaff(cfg, selectedClub.name, mod, interaction.user.id));
    const requestedUsers = interaction.options.getString("usuarios");
    const isSelfCancel = Boolean(interaction.allowLinkedPlayerSelfCancel) &&
      (!requestedUsers || String(requestedUsers).trim() === String(interaction.user.id));

    if (!isAdmin && !isStaff && !isSelfCancel) {
      await sendCapActionAlert(interaction, {
        action: "Intento no permitido de cancelacion",
        club: selectedClub.name,
        modality: modalities.join(", "),
        targets: [interaction.user.id]
      }).catch(() => null);
      return interaction.reply({
        content: "No tenes permiso para cancelar en este foro. Solo puede hacerlo el CAP/SC, un admin o un jugador fichado para autocancelarse.",
        flags: 64
      });
    }

    const userIds = parseUserIds(requestedUsers || interaction.user.id);
    if (!userIds.length) {
      return sendTempInteractionReply(interaction, {
        content: "No se encontro ningun usuario valido. Menciona usuarios o pega IDs separados por coma.",
        flags: 64
      }, TEMP_REPLY_MS);
    }

    const captains = cfg.clubs?.[selectedClub.name]?.captains || {};
    const selfCaptainMods = modalities.filter((mod) =>
      String(captains[mod] || "") === String(interaction.user.id) &&
      userIds.includes(String(interaction.user.id))
    );
    if (selfCaptainMods.length) {
      return interaction.reply({
        content: `No podes cancelarte siendo CAP en **${selfCaptainMods.join(", ")}**. Primero cede la capitania con \`!ce @usuario\`.`,
        flags: 64
      });
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const autoNicknames = shouldAutoNicknames(cfg);
      const lines = [];
      const touchedModalities = new Set();
      const removedIds = [];

      for (const userId of userIds) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) {
          lines.push(`⚠️ <@${userId}> no encontrado.`);
          continue;
        }

        const removed = [];
        for (const mod of modalities) {
          const roleId = clubs.getRoleForClub(selectedClub, mod);
          if (!roleId || !member.roles.cache.has(roleId)) continue;

          await member.roles.remove(roleId, `Cancelado por ${interaction.user.tag}`);
          removeUserClubAffiliation(userId, { club: selectedClub.name, modality: mod, roleId });
          addHistory(userId, "CANCELAR", { club: selectedClub.name, modality: mod, by: interaction.user.tag });

          const captainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "captain");
          if (captainRole?.roleId && member.roles.cache.has(captainRole.roleId) && !stillHasCaptainElsewhere(cfg, selectedClub.name, mod, userId)) {
            await member.roles.remove(captainRole.roleId, `Cancelado por ${interaction.user.tag}`).catch(() => null);
          }

          const subcaptainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "subcaptain");
          if (subcaptainRole?.roleId && member.roles.cache.has(subcaptainRole.roleId) && !stillHasSubElsewhere(cfg, selectedClub.name, mod, userId)) {
            await member.roles.remove(subcaptainRole.roleId, `Cancelado por ${interaction.user.tag}`).catch(() => null);
          }

          if (cfg.clubs?.[selectedClub.name]?.captains?.[mod] && String(cfg.clubs[selectedClub.name].captains[mod]) === String(userId)) {
            delete cfg.clubs[selectedClub.name].captains[mod];
          }
          if (cfg.clubs?.[selectedClub.name]?.subcaptains?.[mod] && String(cfg.clubs[selectedClub.name].subcaptains[mod]) === String(userId)) {
            delete cfg.clubs[selectedClub.name].subcaptains[mod];
          }
          if (cfg.clubs?.[selectedClub.name]?.subcaptains?.general && String(cfg.clubs[selectedClub.name].subcaptains.general) === String(userId)) {
            delete cfg.clubs[selectedClub.name].subcaptains.general;
          }

          await divisions.syncMemberDivisionRoles(interaction.guild, member, cfg, mod, { ensure: false });
          removed.push(mod);
          touchedModalities.add(mod);
        }

        if (autoNicknames) await nicknames.updateNickname(member).catch(() => null);
        const userDataAfter = getUser(userId);
        let remainingAffiliation = null;
        for (const mod of modalities) {
          const next = getUserClubAffiliationForModality(userId, mod);
          if (next) {
            remainingAffiliation = next;
            break;
          }
        }
        if (!remainingAffiliation) {
          outer:
          for (const [clubName, entry] of Object.entries(userDataAfter.clubAffiliations || {})) {
            for (const [mod, affiliation] of Object.entries(entry.modalities || {})) {
              if (!affiliation?.roleId) continue;
              remainingAffiliation = { club: clubName, modality: mod };
              break outer;
            }
          }
        }

        if (remainingAffiliation) {
          const modalityRow = await haxoleSupabase.getModalidadRow(remainingAffiliation.modality).catch(() => null);
          const clubId = await haxoleSupabase.getClubIdByName(remainingAffiliation.club).catch(() => null);
          await haxoleSupabase.upsertPlayerIdentity({
            guildId: interaction.guild.id,
            discordUserId: member.id,
            discordUsername: member.user.tag,
            discordAvatarUrl: member.displayAvatarURL({ size: 128 }),
            haxballName: member.displayName,
            clubId,
            clubName: remainingAffiliation.club,
            modalidadId: modalityRow?.id || null,
            modalidadName: remainingAffiliation.modality,
            source: "cancelo"
          }).catch(() => null);
        } else {
          await haxoleSupabase.upsertPlayerIdentity({
            guildId: interaction.guild.id,
            discordUserId: member.id,
            discordUsername: member.user.tag,
            discordAvatarUrl: member.displayAvatarURL({ size: 128 }),
            haxballName: member.displayName,
            clearCurrentClub: true,
            clearCurrentModality: true,
            source: "cancelo"
          }).catch(() => null);
        }
        if (removed.length) removedIds.push(member.id);
        lines.push(removed.length
          ? `✅ **${member.user.tag}** cancelado en: **${removed.join(", ")}**`
          : `⚠️ **${member.user.tag}** no tenia roles para quitar.`);
      }

      saveConfig(cfg);

      if (removedIds.length) {
        await sendCapActionAlert(interaction, {
          action: "Cancelacion",
          club: selectedClub.name,
          modality: modalities.join(", "),
          targets: removedIds
        }).catch(() => null);
      }

      for (const mod of touchedModalities) {
        void updateLinkedForumTemplates(interaction.guild, selectedClub.name, mod).catch(() => null);
      }

      return interaction.editReply({
        content: [`**Cancelacion en ${selectedClub.name}**`, lines.join("\n")].join("\n")
      });
    } catch (error) {
      console.error("Error en cancelo:", error);
      const payload = error.code === 50013
        ? { content: "No pude quitar roles por permisos. Revisa que el rol del bot este por encima del rol del club.", flags: 64 }
        : { content: "Ocurrio un error al cancelar. Revisa consola para mas detalle.", flags: 64 };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
      return interaction.reply(payload).catch(() => {});
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
      console.error("[cancelo.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
