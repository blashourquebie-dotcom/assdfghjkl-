const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const divisions = require("../utils/divisions");
const seasons = require("../utils/seasons");
const statsStore = require("../utils/statsStore");
const haxoleSupabase = require("../utils/haxoleSupabase");

const parseFecha = (raw) => {
  const match = String(raw || "").trim().match(/^f?(\d+)$/i);
  return match ? Number(match[1]) : null;
};

const readPrefixArgs = (interaction) => {
  const raw = interaction.sourceMessage?.content || "";
  const body = raw.replace(/^\S+\s*/, "").trim();
  if (!body) return null;
  const parts = body.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    modalidad: parts[0] || null,
    fecha: parseFecha(parts[1]),
    tipo: parts[2] || null,
    carga: parts.slice(3).join(", ")
  };
};

const parseLoadItems = (raw) => {
  const items = [];
  const regex = /(<@!?\d+>|\b\d{15,25}\b)\s+(-?\d+:[0-5]\d|-?\d+(?:[\.,]\d+)?)/g;
  let match;
  while ((match = regex.exec(String(raw || "")))) {
    const userId = match[1].match(/\d{15,25}/)?.[0];
    if (userId) items.push({ userId, rawValue: match[2] });
  }
  return items;
};

const findMemberClub = (cfg, member, modality) => {
  for (const [clubName, clubData] of Object.entries(cfg.clubs || {})) {
    const roleId = clubs.getRoleForClub({ name: clubName, ...clubData }, modality);
    if (roleId && member.roles.cache.has(roleId)) {
      return { clubName, clubData, roleId };
    }
  }
  return null;
};

const hasAnyPlayerRole = (cfg, guildId, member, modality) => {
  const roleIds = new Set();
  const first = roleRegistry.getGeneralRole(cfg, guildId, modality, "player");
  if (first?.roleId) roleIds.add(first.roleId);
  const second = cfg.divisionRoles?.[guildId]?.[modality]?.["2da"]?.playerRoleId;
  if (second) roleIds.add(second);
  return Array.from(roleIds).some((roleId) => member.roles.cache.has(roleId));
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cs")
    .setDescription("Carga estadisticas de una fecha para multiples jugadores")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addIntegerOption((o) => o.setName("fecha").setDescription("Numero de fecha").setRequired(true))
    .addStringOption((o) => o.setName("tipo").setDescription("goles, asistencias, valla invicta o goles en contra").setRequired(true).addChoices(
      { name: "Goles", value: "goles" },
      { name: "Asistencias", value: "asistencias" },
      { name: "Valla invicta", value: "valla_invicta" },
      { name: "Goles en contra", value: "goles_contra" }
    ))
    .addStringOption((o) => o.setName("carga").setDescription("@user 2, @user2 3").setRequired(true))
    .addStringOption((o) => o.setName("temporada").setDescription("Opcional: nombre de temporada activa").setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden cargar estadisticas.", flags: 64 });
    }

    const prefixArgs = readPrefixArgs(interaction);
    const modality = roleRegistry.normalizeModality(prefixArgs?.modalidad || interaction.options.getString("modalidad"));
    const fecha = prefixArgs?.fecha || interaction.options.getInteger("fecha");
    const statType = statsStore.normalizeStatType(prefixArgs?.tipo || interaction.options.getString("tipo"));
    const rawLoad = prefixArgs?.carga || interaction.options.getString("carga");
    const requestedSeason = prefixArgs ? null : interaction.options.getString("temporada");

    if (!modality) return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    if (!fecha || fecha < 1) return interaction.reply({ content: "Fecha invalida.", flags: 64 });
    if (!statType) return interaction.reply({ content: "Tipo de estadistica invalido.", flags: 64 });
    if (seasons.isInactiveModality(modality)) return interaction.reply({ content: `La modalidad **${modality}** esta inactiva.`, flags: 64 });

    const season = requestedSeason
      ? seasons.findSeason({ name: requestedSeason, modality, includeFinished: false })
      : seasons.getActiveSeason(modality);
    if (!season) {
      return interaction.reply({
        content: `No hay temporada activa para **${modality}**. Usa una temporada activa antes de cargar stats.`,
        flags: 64
      });
    }

    const items = parseLoadItems(rawLoad);
    if (!items.length) {
      return interaction.reply({ content: "No encontre cargas validas. Ejemplo: `@user 2, @user2 3`.", flags: 64 });
    }

    const cfg = readConfig();
    const savedEntries = [];
    const appliedLines = [];
    const warnings = [];

    for (const item of items) {
      const value = statsStore.parseValue(item.rawValue, statType);
      if (value === null) {
        warnings.push(`<@${item.userId}>: valor invalido para ${statsStore.statLabel(statType)}.`);
        continue;
      }

      const member = await interaction.guild.members.fetch(item.userId).catch(() => null);
      if (!member) {
        warnings.push(`<@${item.userId}>: usuario no encontrado en el servidor.`);
        continue;
      }

      const clubContext = findMemberClub(cfg, member, modality);
      if (!clubContext) {
        warnings.push(`<@${item.userId}>: carga bloqueada, no tiene club registrado en **${modality}**.`);
        continue;
      }

      const division = divisions.getClubDivision(cfg, clubContext.clubName, modality) || "sin division";
      const playerRoleOk = hasAnyPlayerRole(cfg, interaction.guild.id, member, modality);
      const currentTotal = statsStore.sumFor({
        seasonId: season.id,
        modality,
        fecha,
        userId: item.userId,
        statType
      });
      const totalAfter = currentTotal + value;
      const entryWarnings = [];
      if (!playerRoleOk) entryWarnings.push("No tiene rol general de jugador en la modalidad.");
      if (totalAfter < 0) entryWarnings.push("La fecha queda con total negativo.");

      const entry = {
        seasonId: season.id,
        seasonName: season.name,
        modality,
        division,
        fecha,
        userId: item.userId,
        userTag: member.user.tag,
        clubName: clubContext.clubName,
        clubRoleId: clubContext.roleId,
        clubEmoji: clubContext.clubData.emoji || "",
        statType,
        value,
        createdBy: interaction.user.tag,
        warnings: entryWarnings
      };
      savedEntries.push(entry);
      const emoji = entry.clubEmoji ? `${entry.clubEmoji} ` : "";
      const warn = entryWarnings.length ? " âš ï¸" : "";
      appliedLines.push(`${warn} <@${item.userId}> ${member.user.tag} - ${emoji}${clubContext.clubName}: **${statsStore.formatValue(value, statType)}**`);
      for (const reason of entryWarnings) warnings.push(`<@${item.userId}>: ${reason}`);
    }

    if (savedEntries.length) statsStore.addEntries(savedEntries);
    if (savedEntries.length && haxoleSupabase.isEnabled) {
      await haxoleSupabase.syncPlayerTiersForModality(modality).catch((error) => {
        console.error("[cs] Error sincronizando tiers en Supabase:", error);
      });
    }

    const embed = new EmbedBuilder()
      .setColor(savedEntries.length ? 0x2ecc71 : 0xe67e22)
      .setTitle("SE HAN CARGADO LAS ESTADISTICAS")
      .addFields(
        { name: "Modalidad", value: modality, inline: true },
        { name: "Temporada", value: season.displayName || season.name, inline: true },
        { name: "Fecha", value: String(fecha), inline: true },
        { name: "Tipo", value: statsStore.statLabel(statType), inline: true },
        { name: "Cargas aplicadas", value: (appliedLines.join("\n") || "Ninguna.").slice(0, 1024), inline: false },
        { name: "Advertencias", value: (warnings.join("\n") || "Sin advertencias.").slice(0, 1024), inline: false }
      );

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};

