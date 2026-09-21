const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const haxoleSupabase = require("../utils/haxoleSupabase");
const roleRegistry = require("../utils/roleRegistry");

const buildCommandData = (name, description) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addStringOption((o) =>
      o
        .setName("mod")
        .setDescription("Modalidad, ej: x3")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("torneo")
        .setDescription("Nombre del torneo")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption((o) => o.setName("cupos").setDescription("Cantidad a sumar o restar").setRequired(true));

const parseRaw = (raw) => {
  const body = String(raw || "").trim().replace(/^\S+\s*/, "").trim();
  if (!body) return {};
  const named = (key) => {
    const match = body.match(new RegExp(`(?:^|[\\s,;])${key}\\s*[:=]\\s*([^,;]+)`, "i"));
    return match ? match[1].trim() : null;
  };
  const parts = body.split(/\s+/).filter(Boolean);
  const signedInteger = parts.find((part) => /^-?\d+$/.test(part));

  return {
    modalidad: named("modalidad") || named("mod") || parts[0] || null,
    torneo: named("torneo") || named("nombre") || parts[1] || null,
    cupos: parseInt(named("cupos") || named("cupo") || named("cantidad") || named("agregar") || named("restar") || named("quitar") || signedInteger, 10)
  };
};

const buildSlotSummary = (torneo, rows = []) => {
  const capacity = Math.max(0, Number(torneo?.cantidad_equipos || 0));
  const occupied = new Map();
  const overflow = [];
  const used = new Set();

  const orderedRows = Array.isArray(rows)
    ? rows.slice().sort((a, b) =>
        (Number(a.posicion) || 9999) - (Number(b.posicion) || 9999) ||
        String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
        String(a.club?.nombre || a.club_id || "").localeCompare(String(b.club?.nombre || b.club_id || ""), "es", { sensitivity: "base" })
      )
    : [];

  for (const row of orderedRows) {
    const clubLabel = row?.club?.nombre || row?.club?.name || row?.club_id || "Club desconocido";
    let position = Number(row?.posicion);
    if (!Number.isInteger(position) || position < 1 || position > capacity || used.has(position)) {
      position = 1;
      while (position <= capacity && used.has(position)) position += 1;
    }

    if (position > capacity) {
      overflow.push(clubLabel);
      continue;
    }

    used.add(position);
    occupied.set(position, clubLabel);
  }

  const lines = [];
  for (let i = 1; i <= capacity; i += 1) {
    if (occupied.has(i)) {
      lines.push(`Cupo ocupado #${i}: **${occupied.get(i)}**`);
    } else {
      lines.push(`Cupo libre #${i}`);
    }
  }

  if (!lines.length) {
    lines.push("No hay cupos definidos en este torneo.");
  }

  if (overflow.length) {
    lines.push("");
    lines.push(`Cupos fuera de rango detectados: ${overflow.map((name) => `**${name}**`).join(", ")}`);
  }

  return lines.join("\n");
};

const execute = async (interaction) => {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
  }

  const parsed = parseRaw(interaction.sourceMessage?.content || "");
  const modalidad = roleRegistry.normalizeModality(interaction.options.getString("mod") || interaction.options.getString("modalidad") || parsed.modalidad);
  const torneoName = interaction.options.getString("torneo") || parsed.torneo;
  const cupos = interaction.options.getInteger("cupos");
  const delta = Number.isInteger(cupos) ? cupos : parsed.cupos;

  if (!modalidad || !torneoName || !Number.isInteger(delta) || delta === 0) {
    return interaction.reply({ content: "Modalidad, torneo o cupos invalidos.", flags: 64 });
  }

  const updated = await haxoleSupabase.adjustTournamentSlots({
    modality: modalidad,
    name: torneoName,
    slots: delta
  });

  if (!updated?.ok) {
    return interaction.reply({
      content: updated?.reason
        ? `No pude actualizar los cupos de **${torneoName}** en **${modalidad}**. ${updated.reason}`
        : `No encontre el torneo **${torneoName}** en **${modalidad}**.`,
      flags: 64
    });
  }

  const torneo = updated.tournament;
  const rows = await haxoleSupabase.getTournamentClubRows(torneo.id);
  const slotSummary = buildSlotSummary(torneo, rows);

  return interaction.reply({
    content: [
      `Cupos actualizados: **${torneo.nombre}** ahora tiene **${torneo.cantidad_equipos}** cupos.`,
      `Cambio aplicado: **${delta > 0 ? "+" : ""}${delta}**.`,
      "",
      slotSummary
    ].join("\n"),
    flags: 64
  });
};

module.exports = {
  disabled: true,
  buildCommandData,
  buildSlotSummary,
  data: buildCommandData("cupos", "Aumenta o reduce los cupos de un torneo"),
  execute,
  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);

      if (focused.name === "mod" || focused.name === "modalidad") {
        const query = String(focused.value || "").toLowerCase();
        const options = roleRegistry.getEnabledModalities(readConfig())
          .filter((mod) => !query || mod.includes(query))
          .slice(0, 25)
          .map((mod) => ({ name: mod, value: mod }));
        return interaction.respond(options);
      }

      if (focused.name === "torneo") {
        const modality = roleRegistry.normalizeModality(interaction.options.getString("mod") || interaction.options.getString("modalidad"));
        if (!modality || !haxoleSupabase.isEnabled) {
          return interaction.respond([]);
        }

        const query = String(focused.value || "").toLowerCase();
        const torneos = await haxoleSupabase.listTorneosByModalidad(modality);
        const options = torneos
          .filter((torneo) => !query || String(torneo.nombre || "").toLowerCase().includes(query))
          .slice(0, 25)
          .map((torneo) => ({ name: torneo.nombre, value: torneo.nombre }));
        return interaction.respond(options);
      }
    } catch (error) {
      console.error("[cupos.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
