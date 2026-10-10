const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const haxoleSupabase = require("../utils/haxoleSupabase");

async function replacementRows(tournamentId, enrolled) {
  const result = await haxoleSupabase.request('rpc/tournament_replacement_candidates', {method:'POST',body:{p_id:tournamentId}});
  if (!result.ok) throw new Error('Falta actualizar los cupos: aplicá 202610040002_preserve_vacant_clubs.sql.');
  return [...enrolled, ...(result.data || []).filter(row=>row.vacant).map(row=>({club_id:row.club_id,posicion:row.posicion,vacant:true,club:{nombre:row.nombre}}))];
}

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
    .addStringOption((o) => o.setName("club_a_reemplazar").setDescription("Club o Cupo 1, Cupo 2, etc.").setRequired(false).setAutocomplete(true)),

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
    if (!clubs.getRoleForClub(clubEntry, modality)) {
      return interaction.reply({ content: `**${clubEntry.name}** no está habilitado en **${modality}**.`, flags: 64 });
    }

    const torneo = await haxoleSupabase.getTournament({ modality, name: torneoName });
    if (!torneo) {
      return interaction.reply({ content: `No encontré el torneo **${torneoName}** en **${modality}**.`, flags: 64 });
    }
    if (torneo.estado && torneo.estado !== 'activo') {
      return interaction.reply({ content: `**${torneo.nombre}** no está activo; no se pueden modificar sus cupos.`, flags: 64 });
    }

    const currentRows = await haxoleSupabase.getTournamentClubRows(torneo.id);
    let candidates;
    try { candidates = await replacementRows(torneo.id, currentRows); }
    catch (error) { return interaction.reply({content:error.message,flags:64}); }
    const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const slotMatch = replaceClubQuery?.trim().match(/^cupo(?:\s+libre)?\s*#?\s*(\d+)$/i);
    const explicitSlot = slotMatch ? Number(slotMatch[1]) : null;
    if (explicitSlot !== null && (explicitSlot < 1 || explicitSlot > Number(torneo.cantidad_equipos))) {
      return interaction.reply({ content: `El cupo debe estar entre 1 y ${torneo.cantidad_equipos}.`, flags: 64 });
    }
    const inactiveRows = candidates.filter(row => row.vacant || !clubs.getRoleForClub(clubs.findClub(row.club?.nombre), modality));
    const replaceRow = explicitSlot !== null
      ? candidates.find(row => Number(row.posicion) === explicitSlot)
      : replaceClubQuery
        ? candidates.find(row => [row.club?.nombre, row.club?.abreviacion, row.club?.nombre_corto].some(value => normalize(value) === normalize(replaceClubQuery)))
        : inactiveRows.sort((a,b)=>Number(a.posicion||0)-Number(b.posicion||0))[0] || null;
    const alreadyLinked = currentRows.some((row) => normalize(row.club?.nombre) === normalize(clubEntry.name));

    if (replaceClubQuery && explicitSlot === null && !replaceRow) {
      return interaction.reply({
        content: `No encontré el club a reemplazar **${replaceClubQuery}** dentro de **${torneo.nombre}**.`,
        flags: 64
      });
    }
    if (alreadyLinked) {
      return interaction.reply({
        content: `El club **${clubEntry.name}** ya está inscripto en **${torneo.nombre}** (${modality}).`,
        flags: 64
      });
    }

    if (!replaceRow && explicitSlot === null && currentRows.length >= Number(torneo.cantidad_equipos || 0)) {
      return interaction.reply({
        content: `El torneo **${torneo.nombre}** ya completó su cupo. Hay que liberar o ampliar cupo primero.`,
        flags: 64
      });
    }

    try {
      if (replaceRow || explicitSlot !== null) {
        const incoming = await haxoleSupabase.ensureClubRow(clubEntry.name);
        if (!incoming?.id) throw new Error('No se encontró el club habilitado en la base de datos.');
        await haxoleSupabase.setTournamentSlot({ torneoId: torneo.id, slot: explicitSlot ?? Number(replaceRow.posicion), incomingClubId: incoming.id, guildId: interaction.guild.id });
      } else {
        const occupied = new Set(currentRows.map(row=>Number(row.posicion)).filter(Number.isInteger));
        const targetPosition = Array.from({length:Number(torneo.cantidad_equipos||0)},(_,i)=>i+1).find(position=>!occupied.has(position));
        if (!targetPosition) throw new Error('No queda un cupo libre en el torneo.');
        const incoming = await haxoleSupabase.ensureClubRow(clubEntry.name);
        if (!incoming?.id) throw new Error('No se encontró el club habilitado en la base de datos.');
        await haxoleSupabase.setTournamentSlot({ torneoId: torneo.id, slot: targetPosition, incomingClubId: incoming.id, guildId: interaction.guild.id });
      }
    } catch (error) {
      console.error("[entry] Error inscribiendo club en torneo:", error);
      return interaction.reply({ content: `No se pudo inscribir el club: ${error.message || error}`, flags: 64 });
    }

    return interaction.reply({
      content: replaceRow || explicitSlot !== null
        ? `✅ Club **${clubEntry.name}** ocupó el Cupo ${explicitSlot ?? replaceRow.posicion}${replaceRow ? ` de **${replaceRow.club?.nombre}**` : ''} en **${torneo.nombre}** (${modality}). Los resultados y estadísticas pasan al club entrante; el fixture conserva el reemplazo.`
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
        const torneoName = interaction.options.getString('torneo');
        const torneo = torneoName && modality ? await haxoleSupabase.getTournament({ modality, name: torneoName }) : null;
        if (!torneo) return interaction.respond([]);
        const rows = await replacementRows(torneo.id, await haxoleSupabase.getTournamentClubRows(torneo.id));
        const query = String(focused.value || '').toLowerCase();
        const options = Array.from({ length: Number(torneo.cantidad_equipos || 0) }, (_, i) => {
          const occupant = rows.find(row => Number(row.posicion) === i + 1);
          return { name: `Cupo ${i + 1} · ${occupant?.club?.nombre || 'libre'}`, value: `Cupo ${i + 1}` };
        }).concat(rows.map(row => ({ name: row.club?.nombre || row.club_id, value: row.club?.nombre || row.club_id })))
          .filter(option => !query || option.name.toLowerCase().includes(query) || option.value.toLowerCase().includes(query))
          .slice(0, 25);
        return interaction.respond(options);
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
