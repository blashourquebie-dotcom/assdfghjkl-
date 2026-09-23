const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, upsertUserClubAffiliation, removeUserClubAffiliation, addHistory } = require("../utils/database");
const clubsUtil = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const nicknames = require("../utils/nicknames");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const { maybePlaceBelow } = require("../utils/serverSetup");
const haxoleSupabase = require("../utils/haxoleSupabase");

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

const normalizeEmojiName = (abbr) => {
  const clean = String(abbr || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  return (clean || "club").slice(0, 32);
};

const isImageAttachment = (attachment) => {
  if (!attachment) return false;
  const contentType = String(attachment.contentType || "").toLowerCase();
  if (contentType.startsWith("image/")) return true;
  const name = String(attachment.name || attachment.url || "");
  return IMAGE_FILE_RE.test(name);
};

const fetchAttachmentBuffer = async (attachment) => {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`No pude descargar la imagen (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("habilitarclub")
    .setDescription("Habilita un club para modalidades especificas")
    .addStringOption((o) => o.setName("club").setDescription("Nombre del club").setRequired(true))
    .addStringOption((o) => o.setName("abreviacion").setDescription("Abreviacion de 2 a 4 letras").setRequired(true))
    .addStringOption((o) => o.setName("modalidades").setDescription("Modalidades separadas por coma, ej: x3,x4,x7").setRequired(true).setAutocomplete(true))
    .addUserOption((o) => o.setName("capitan").setDescription("Opcional: ficha y marca CAP en esas modalidades").setRequired(false))
    .addAttachmentOption((o) => o.setName("imagen").setDescription("Opcional: imagen del escudo/logo del club").setRequired(false))
    .addStringOption((o) => o.setName("torneo").setDescription("Opcional: nombre de torneo para inscribir el club").setRequired(false).setAutocomplete(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const nombre = interaction.options.getString("club");
    const abbr = interaction.options.getString("abreviacion");
    const modalidadesRaw = interaction.options.getString("modalidades");
    const capitan = interaction.options.getUser("capitan");
    const imagen = interaction.options.getAttachment("imagen");
    const torneoName = interaction.options.getString("torneo");

    const cfg = readConfig();
    const conflictKey = clubsUtil.isNameOrAbbrTaken(nombre, abbr);
    if (conflictKey) {
      return interaction.reply({ content: `La abreviacion o nombre ya esta en uso por **${conflictKey}**.`, flags: 64 });
    }

    if (imagen && !isImageAttachment(imagen)) {
      return interaction.reply({
        content: "La imagen debe ser un archivo valido tipo PNG, JPG, GIF o WEBP.",
        flags: 64
      });
    }

    try {
      const parsed = roleRegistry.parseModalitiesInput(modalidadesRaw);
      const modalidades = parsed.modalities;
      if (parsed.invalid.length) return interaction.reply({ content: `Modalidades invalidas: ${parsed.invalid.join(", ")}`, flags: 64 });
      if (!modalidades.length) return interaction.reply({ content: "No se especificaron modalidades validas.", flags: 64 });
      if (torneoName && modalidades.length !== 1) {
        return interaction.reply({
          content: "Para inscribir un club en un torneo, usa una sola modalidad en este comando.",
          flags: 64
        });
      }

      const disabled = modalidades.filter((mod) => !roleRegistry.isEnabledModality(cfg, mod));
      if (disabled.length) {
        return interaction.reply({ content: `Estas modalidades no estan habilitadas globalmente: ${disabled.join(", ")}`, flags: 64 });
      }

      const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
      if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'El bot necesita Administrar roles para habilitar el club y ordenar sus roles.', flags: 64 });
      }
      for (const mod of modalidades) {
        const playerRoleId = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, 'player')?.roleId;
        const playerRole = playerRoleId && (interaction.guild.roles.cache.get(playerRoleId) || await interaction.guild.roles.fetch(playerRoleId).catch(() => null));
        if (!playerRole) return interaction.reply({ content: `Falta el rol jugador de ${mod}. Configurá los roles de la modalidad antes de habilitar el club.`, flags: 64 });
      }

      let logoUrl = imagen?.url || null;
      let createdEmoji = null;
      let emojiWarning = null;

      if (imagen) {
        try {
          const emojiBuffer = await fetchAttachmentBuffer(imagen);
          const emojiName = normalizeEmojiName(abbr);
          const emoji = await interaction.guild.emojis.create({
            attachment: emojiBuffer,
            name: emojiName,
            reason: `Emoji creado por /habilitarclub para ${nombre}`
          });
          createdEmoji = typeof emoji?.toString === "function"
            ? emoji.toString()
            : (emoji?.id && emoji?.name ? `<:${emoji.name}:${emoji.id}>` : null);
        } catch (error) {
          emojiWarning = `No pude crear el emoji automaticamente: ${error?.message || error}`;
          console.error("[habilitarclub] Error creando emoji desde imagen:", error);
        }
      }

      const createdClub = clubsUtil.registerClub(nombre, abbr, {
        shortName: nombre,
        logoUrl,
        emoji: createdEmoji,
        modalidades
      });
      const createdRoles = [];
      const roleIdsByMod = {};
      const gid = interaction.guild.id;

      for (const mod of modalidades) {
        const role = await interaction.guild.roles.create({
          name: `${nombre} ${mod}`,
          colors: { primaryColor: 0xFFFFFF },
          reason: `Rol creado por /habilitarclub para ${nombre} ${mod}`
        });

        clubsUtil.linkRoleToClub(createdClub.name, mod, role.id);

        const cfgClub = readConfig();
        cfgClub.clubs[createdClub.name].affiliations = cfgClub.clubs[createdClub.name].affiliations || {};
        cfgClub.clubs[createdClub.name].affiliations[mod] = {
          date: new Date().toISOString(),
          by: interaction.user.tag,
          roleId: role.id
        };
        roleRegistry.addClubRole(cfgClub, gid, mod, {
          roleId: role.id,
          name: nombre,
          createdAt: new Date().toISOString()
        });
        if (cfgClub.roleLimits?.[mod] && !cfgClub.roleLimits?.[role.id]) {
          cfgClub.roleLimits[role.id] = cfgClub.roleLimits[mod];
        }
        saveConfig(cfgClub);

        const playerRole = roleRegistry.getGeneralRole(cfgClub, gid, mod, "player");
        const anchorRole = playerRole?.roleId
          ? interaction.guild.roles.cache.get(playerRole.roleId) || await interaction.guild.roles.fetch(playerRole.roleId).catch(() => null)
          : null;
        if (!anchorRole) throw new Error(`Falta el rol jugador de ${mod}; no se pudo ubicar ${nombre} ${mod}`);
        const positioned = await maybePlaceBelow(interaction.guild, role, anchorRole);
        if (!positioned && role.position >= anchorRole.position) throw new Error(`No se pudo ubicar ${nombre} ${mod} debajo de jugador ${mod}`);

        createdRoles.push(`${nombre} ${mod}`);
        roleIdsByMod[mod] = role.id;
      }

      if (capitan) {
        const member = await interaction.guild.members.fetch(capitan.id);
        const cfgCap = readConfig();
        cfgCap.clubs[createdClub.name].captains = cfgCap.clubs[createdClub.name].captains || {};

        for (const mod of modalidades) {
          const roleId = roleIdsByMod[mod];
          const conflicts = roleRegistry
            .getClubRoles(cfgCap, gid, mod)
            .filter((entry) => entry.roleId !== roleId && member.roles.cache.has(entry.roleId));

          for (const conflict of conflicts) {
            await member.roles.remove(conflict.roleId, `Reemplazado por ${interaction.user.tag} via /habilitarclub`);
            removeUserClubAffiliation(capitan.id, { club: conflict.name, modality: mod, roleId: conflict.roleId });
            addHistory(capitan.id, "CANCELAR", {
              modality: mod,
              club: conflict.name,
              by: interaction.user.tag,
              reason: "Reemplazado por /habilitarclub"
            });
            if (cfgCap.clubs?.[conflict.name]?.captains?.[mod] === capitan.id) {
              delete cfgCap.clubs[conflict.name].captains[mod];
            }
          }

          if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, "Fichado automaticamente por /habilitarclub");

          const playerRole = roleRegistry.getGeneralRole(cfgCap, gid, mod, "player");
          if (playerRole?.roleId && !member.roles.cache.has(playerRole.roleId)) {
            await member.roles.add(playerRole.roleId, "Rol jugador agregado por /habilitarclub");
          }

          const captainRole = roleRegistry.getGeneralRole(cfgCap, gid, mod, "captain");
          if (captainRole?.roleId && !member.roles.cache.has(captainRole.roleId)) {
            await member.roles.add(captainRole.roleId, "Rol CAP agregado por /habilitarclub");
          }

          cfgCap.clubs[createdClub.name].captains[mod] = capitan.id;
          upsertUserClubAffiliation(capitan.id, {
            club: createdClub.name,
            abbr,
            modality: mod,
            roleId,
            by: interaction.user.tag
          });
          addHistory(capitan.id, "FICHO", { modality: mod, club: createdClub.name, by: interaction.user.tag });

          for (const conflict of conflicts) {
            await updateLinkedForumTemplates(interaction.guild, conflict.name, mod).catch(() => null);
          }
        }

        saveConfig(cfgCap);
        await nicknames.updateNickname(member).catch(() => null);
      }

      if (haxoleSupabase.isEnabled) {
        await haxoleSupabase.ensureClubRow(createdClub.name, {
          abbr: createdClub.abbr,
          shortName: createdClub.shortName,
          logoUrl: createdClub.logoUrl,
          pack: createdClub.pack,
          modalidades,
          emoji: createdClub.emoji,
          capitan: capitan?.id || null
        }).catch((error) => {
          console.error("[habilitarclub] Error sincronizando club en Supabase:", error);
        });
      }

      if (torneoName) {
        const mod = modalidades[0];
        const torneo = await haxoleSupabase.getTournament({ modality: mod, name: torneoName });
        if (!torneo) {
          return interaction.reply({
            content: `No encontre el torneo **${torneoName}** en **${mod}**. Crealo primero con \`/creartorneo\`.`,
            flags: 64
          });
        }

        const currentRows = await haxoleSupabase.getTournamentClubRows(torneo.id);
        const alreadyLinked = currentRows.some((row) => String(row.club?.nombre || row.club_id) === String(createdClub.name));
        if (!alreadyLinked && currentRows.length >= Number(torneo.cantidad_equipos || 0)) {
          return interaction.reply({
            content: `El torneo **${torneo.nombre}** ya completo su cupo. Hay que liberar o ampliar cupo primero.`,
            flags: 64
          });
        }

        if (!alreadyLinked) {
          await haxoleSupabase.setTournamentClub({
            torneoId: torneo.id,
            clubName: createdClub.name,
            position: currentRows.length + 1
          }).catch((error) => {
            console.error("[habilitarclub] Error inscribiendo club en torneo:", error);
          });
        }
      }

      return interaction.reply({
        content: [
          `✅ Club **${nombre}** (${abbr}) habilitado para: ${modalidades.join(", ")}`,
          `Roles creados: ${createdRoles.join(", ")}`,
          createdClub.logoUrl ? `Logo guardado: ${createdClub.logoUrl}` : null,
          createdClub.emoji ? `Emoji creado: ${createdClub.emoji}` : null,
          capitan ? `CAP fichado: ${capitan.tag}` : null
        ].filter(Boolean).join("\n"),
        flags: 64
      });
    } catch (error) {
      console.error("[habilitarclub] Error:", error);
      return interaction.reply({ content: "Error al habilitar el club.", flags: 64 });
    }
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      const cfg = readConfig();

      if (focused.name === "modalidades") {
        const query = String(focused.value || "").toLowerCase();
        const already = new Set(
          String(interaction.options.getString("modalidades") || "")
            .split(",")
            .map((part) => roleRegistry.normalizeModality(part))
            .filter(Boolean)
        );

        const options = roleRegistry.getEnabledModalities(cfg)
          .filter((mod) => !already.has(mod))
          .filter((mod) => !query || mod.includes(query))
          .slice(0, 25)
          .map((mod) => ({ name: mod, value: mod }));

        return interaction.respond(options);
      }

      if (focused.name === "torneo") {
        const parsedModalidades = roleRegistry.parseModalitiesInput(interaction.options.getString("modalidades") || "");
        const modality = parsedModalidades.modalities[0] || null;
        if (!modality || !haxoleSupabase.isEnabled) return interaction.respond([]);

        const torneos = await haxoleSupabase.listTorneosByModalidad(modality);
        const query = String(focused.value || "").toLowerCase();
        const options = torneos
          .filter((torneo) => !query || String(torneo.nombre || "").toLowerCase().includes(query))
          .slice(0, 25)
          .map((torneo) => ({
            name: torneo.nombre,
            value: torneo.nombre
          }));

        return interaction.respond(options);
      }
    } catch (error) {
      console.error("[habilitarclub.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
