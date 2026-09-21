const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const haxoleSupabase = require("../utils/haxoleSupabase");
const { formatFixtureView } = require("../utils/fixtures");

const { buildInitialFixture, buildNextRound } = require("../utils/tournamentFormat");
const ACTIONS = ["crear", "ver", "borrar", "avanzar"];

const getForumLink = (interaction) => {
  const cfg = readConfig();
  return cfg.forumClubs?.[interaction.channel?.id] || cfg.forumClubs?.[interaction.channel?.parentId] || null;
};

const getSelectedModality = (interaction, fallback = null) =>
  roleRegistry.normalizeModality(
    interaction.options.getString("modalidad") ||
      fallback ||
      null
  );

const resolveTournament = async (interaction, modality, query) => {
  if (!modality || !query) return null;
  const torneos = await haxoleSupabase.listTorneosByModalidad(modality);
  return torneos.find((torneo) => String(torneo.nombre || "").toLowerCase() === String(query).toLowerCase()) || null;
};

const getAction = (interaction) => {
  const value = String(interaction.options.getString("accion") || "").toLowerCase().trim();
  return ACTIONS.includes(value) ? value : null;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Crea, ve o borra el fixture de un torneo")
    .addStringOption((o) =>
      o.setName("accion")
        .setDescription("crear, ver o borrar")
        .setRequired(true)
        .addChoices(
          { name: "Crear", value: "crear" },
          { name: "Ver", value: "ver" },
          { name: "Borrar", value: "borrar" },
          { name: "Avanzar de ronda", value: "avanzar" }
        )
    )
    .addStringOption((o) =>
      o.setName("torneo")
        .setDescription("Torneo destino")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("modalidad")
        .setDescription("Modalidad del torneo")
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const forumLink = getForumLink(interaction);
    const action = getAction(interaction);
    const modality = getSelectedModality(interaction, forumLink?.modality);
    const torneoName = interaction.options.getString("torneo");

    if (!action) {
      return interaction.reply({ content: "Accion invalida.", flags: 64 });
    }
    if (!modality) {
      return interaction.reply({ content: "No pude detectar la modalidad. Elegila o ejecuta el comando dentro de una sede vinculada.", flags: 64 });
    }

    const torneo = await resolveTournament(interaction, modality, torneoName);
    if (!torneo) {
      return interaction.reply({ content: `No encontre el torneo **${torneoName}** en **${modality}**.`, flags: 64 });
    }

    if (action === "borrar") {
      const removed = await haxoleSupabase.deleteFixtureRows(torneo.id).catch(() => false);
      if (!removed) {
        return interaction.reply({ content: "No pude borrar el fixture de Supabase.", flags: 64 });
      }
      return interaction.reply({
        content: `Fixture borrado para **${torneo.nombre}** en **${modality}**.`,
        flags: 64
      });
    }

    const rows = await haxoleSupabase.getTournamentClubRows(torneo.id);
    if (!rows.length) {
      return interaction.reply({ content: `El torneo **${torneo.nombre}** no tiene clubes inscriptos.`, flags: 64 });
    }

    if (action === "crear" || action === "avanzar") {
      const config = { formato: torneo.formato || (torneo.modo_copa ? "copa" : "liga"), ida_vuelta: false, clasifican: 2, etiquetas: [], ...torneo.configuracion };
      try {
        const existing = [];
        for (let offset = 0; ; offset += 500) {
          const result = await haxoleSupabase.request("partidos", { params: { torneo_id: "eq." + torneo.id, select: "*", order: "id.asc", limit: 500, offset } });
          if (!result.ok || !Array.isArray(result.data)) throw new Error("No se pudo comprobar el fixture existente.");
          existing.push(...result.data);
          if (result.data.length < 500) break;
        }
        if (action === "crear" && existing.length) throw new Error("Ya existe un fixture. No se reemplazará: usá avanzar, o borrá explícitamente el fixture si corresponde.");
        if (action === "crear" && rows.length !== torneo.cantidad_equipos) throw new Error("Completá la inscripción de los " + torneo.cantidad_equipos + " clubes antes de crear el fixture.");
        const next = action === "crear" ? { rows: buildInitialFixture(rows, config) } : buildNextRound(existing, config);
        if (next.champion) return interaction.reply({ content: "Torneo finalizado. Campeón: " + (rows.find((r) => r.club_id === next.champion)?.club?.nombre || next.champion), flags: 64 });
        const payload = next.rows.map((match) => ({ ...match, torneo_id: torneo.id, jugado: false, goles_local: null, goles_visitante: null }));
        const saved = await haxoleSupabase.request("rpc/append_configured_tournament_fixture", { method: "POST", body: { p_tournament: torneo.id, p_expected_count: existing.length, p_rows: payload, p_expected_config: torneo.configuracion || {} } });
        if (!saved.ok) throw new Error("No se guardó el fixture. Verificá la migración 202609100001 o si otro administrador ya avanzó la ronda.");
        return interaction.reply({ content: "Fixture guardado para " + torneo.nombre + ": " + payload.length + " partidos.", flags: 64 });
      } catch (error) { return interaction.reply({ content: error.message, flags: 64 }); }
    }

    const fixtureRows = await haxoleSupabase.listFixtureRows(torneo.id);
    if (!fixtureRows.length) {
      return interaction.reply({ content: `Todavia no hay fixture para **${torneo.nombre}** en **${modality}**.`, flags: 64 });
    }

    const view = formatFixtureView(fixtureRows);
    const embed = new EmbedBuilder()
      .setTitle(`Fixture de ${torneo.nombre}`)
      .setColor(0x2ecc71)
      .setDescription(`\`\`\`\n${view.slice(0, 3900)}\n\`\`\``);

    return interaction.reply({ embeds: [embed], flags: 64 });
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

      if (focused.name === "torneo" && modality) {
        const query = String(focused.value || "").toLowerCase();
        const torneos = await haxoleSupabase.listTorneosByModalidad(modality);
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
      console.error("[schedule.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
