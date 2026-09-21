const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const haxoleSupabase = require("../utils/haxoleSupabase");

const getForumLink = (interaction) => {
  const cfg = readConfig();
  return cfg.forumClubs?.[interaction.channel?.id] || cfg.forumClubs?.[interaction.channel?.parentId] || null;
};

const getSelectedModality = (interaction, fallback = null) => {
  return roleRegistry.normalizeModality(
    interaction.options.getString("modalidad") ||
    fallback ||
    null
  );
};

const getClubAutocomplete = async (interaction, modality, query) => {
  const filtered = clubs.searchClubs(query)
    .filter((club) => {
      if (!modality) return true;
      const roleId = clubs.getRoleForClub(club, modality);
      return Boolean(roleId);
    })
    .slice(0, 25)
    .map((club) => ({
      name: club.abbr ? `${club.name} (${club.abbr})` : club.name,
      value: club.name
    }));

  await interaction.respond(filtered);
};

const getTorneosAutocomplete = async (interaction, modality, query) => {
  if (!modality || !haxoleSupabase.isEnabled) {
    await interaction.respond([]);
    return;
  }

  const torneos = await haxoleSupabase.listTorneosByModalidad(modality);
  const options = torneos
    .filter((torneo) => !query || String(torneo.nombre || "").toLowerCase().includes(query.toLowerCase()))
    .slice(0, 25)
    .map((torneo) => ({
      name: torneo.nombre,
      value: torneo.nombre
    }));

  await interaction.respond(options);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("entry")
    .setDescription("Inscribe un club en un torneo")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(false).setAutocomplete(true))
    .addStringOption((o) => o.setName("club").setDescription("Club a inscribir").setRequired(false).setAutocomplete(true))
    .addStringOption((o) => o.setName("torneo").setDescription("Torneo destino").setRequired(false).setAutocomplete(true))
    .addStringOption((o) => o.setName("club_a_reemplazar").setDescription("Opcional: club que sera reemplazado").setRequired(false).setAutocomplete(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const forumLink = getForumLink(interaction);
    const modality = getSelectedModality(interaction, forumLink?.modality);
    const clubQuery = interaction.options.getString("club") || forumLink?.club || null;
    const torneoName = interaction.options.getString("torneo") || null;
    const replaceClubQuery = interaction.options.getString("club_a_reemplazar") || null;

    if (!modality) {
      return interaction.reply({ content: "No pude detectar la modalidad. Elegila o usá el comando dentro del foro del club.", flags: 64 });
    }

    if (!clubQuery) {
      return interaction.reply({ content: "No pude detectar el club. Elegilo o usá el comando dentro del foro del club.", flags: 64 });
    }

    if (!torneoName) {
      return interaction.reply({ content: "Tenés que indicar el torneo destino.", flags: 64 });
    }

    const clubEntry = clubs.findClub(clubQuery);
    if (!clubEntry) {
      return interaction.reply({ content: `No encontré el club **${clubQuery}**.`, flags: 64 });
    }

    const replaceClubEntry = replaceClubQuery ? clubs.findClub(replaceClubQuery) : null;
    const torneo = await haxoleSupabase.getTournament({ modality, name: torneoName });
    if (!torneo) {
      return interaction.reply({ content: `No encontré el torneo **${torneoName}** en **${modality}**.`, flags: 64 });
    }

    const currentRows = await haxoleSupabase.getTournamentClubRows(torneo.id);
    const replaceRow = replaceClubEntry
      ? currentRows.find((row) => String(row.club?.nombre || row.club_id) === String(replaceClubEntry.name))
      : null;
    const alreadyLinked = currentRows.some((row) => String(row.club?.nombre || row.club_id) === String(clubEntry.name));

    if (replaceClubQuery && !replaceClubEntry) {
      return interaction.reply({
        content: `No encontré el club a reemplazar **${replaceClubQuery}**.`,
        flags: 64
      });
    }

    if (replaceClubQuery && !replaceRow) {
      return interaction.reply({
        content: `No encontré el club a reemplazar **${replaceClubEntry.name}** dentro de **${torneo.nombre}**.`,
        flags: 64
      });
    }

    if (alreadyLinked && !replaceRow) {
      return interaction.reply({
        content: `El club **${clubEntry.name}** ya está inscripto en **${torneo.nombre}** (${modality}).`,
        flags: 64
      });
    }

    if (!replaceRow && currentRows.length >= Number(torneo.cantidad_equipos || 0)) {
      return interaction.reply({
        content: `El torneo **${torneo.nombre}** ya completó su cupo. Hay que liberar o ampliar cupo primero.`,
        flags: 64
      });
    }

    const targetPosition = replaceRow ? Number(replaceRow.posicion) || currentRows.length + 1 : currentRows.length + 1;

    await haxoleSupabase.setTournamentClub({
      torneoId: torneo.id,
      clubName: clubEntry.name,
      position: targetPosition,
      replaceClubId: replaceRow ? replaceRow.club_id : null
    }).catch((error) => {
      console.error("[entry] Error inscribiendo club en torneo:", error);
    });

    return interaction.reply({
      content: replaceRow
        ? `✅ Club **${clubEntry.name}** reemplazó a **${replaceClubQuery}** en **${torneo.nombre}** (${modality}).`
        : `✅ Club **${clubEntry.name}** inscrito en **${torneo.nombre}** (${modality}).`,
      flags: 64
    });
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      const forumLink = getForumLink(interaction);
      const modality = getSelectedModality(interaction, forumLink?.modality);

      if (focused.name === "modalidad") {
        const query = String(focused.value || "").toLowerCase();
        const options = roleRegistry.getEnabledModalities(readConfig())
          .filter((mod) => !query || mod.includes(query))
          .slice(0, 25)
          .map((mod) => ({ name: mod, value: mod }));
        return interaction.respond(options);
      }

      if (focused.name === "club") {
        return getClubAutocomplete(interaction, modality, String(focused.value || ""));
      }

      if (focused.name === "club_a_reemplazar") {
        return getClubAutocomplete(interaction, modality, String(focused.value || ""));
      }

      if (focused.name === "torneo") {
        return getTorneosAutocomplete(interaction, modality, String(focused.value || ""));
      }
    } catch (error) {
      console.error("[entry.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
