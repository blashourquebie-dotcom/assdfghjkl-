const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const roleRegistry = require("../utils/roleRegistry");
const tournamentScope = require("../utils/tournamentScope");

const parseRaw = (raw) => {
  const body = String(raw || "").trim().replace(/^\S+\s*/, "").trim();
  if (!body) return {};

  const named = (key) => {
    const match = body.match(new RegExp(`(?:^|[\\s,;])${key}\\s*[:=]\\s*([^,;]+)`, "i"));
    return match ? match[1].trim() : null;
  };

  const parts = body.split(/\s+/).filter(Boolean);
  const cantidad = Number(
    named("cantidad_equipos")
    || named("cantidad")
    || named("equipos")
    || parts.find((part) => /^\d+$/.test(part))
    || 0
  ) || null;

  const modoFlag = named("modo_copa");
  const modoRaw = named("modo") || named("tipo_modo") || (modoFlag && /^(true|1|si|sí|on|copa|mata[\s_-]*mata)$/i.test(modoFlag) ? "copa" : null) || body.match(/\b(liga|copa|mata[\s_-]*mata)\b/i)?.[1] || null;

  return {
    modalidad: named("modalidad") || parts[0] || null,
    torneo: named("torneo") || named("nombre") || parts.slice(1, cantidad ? -1 : undefined).join(" ") || null,
    cantidad,
    modo: modoRaw ? String(modoRaw).toLowerCase() : null,
    tipo: named("tipo") || null
  };
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("creartorneo")
    .setDescription("Crea un torneo para la web")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("torneo").setDescription("Nombre del torneo").setRequired(true))
    .addIntegerOption((o) => o
      .setName("cantidad_equipos")
      .setDescription("Opcional para Liga/Copa; para grupos se configura en el panel")
      .setRequired(false)
      .setMinValue(2).setMaxValue(128))
    .addStringOption((o) => o
      .setName("modo")
      .setDescription("Modo del torneo")
      .setRequired(false)
      .addChoices(
        { name: "Liga", value: "liga" },
        { name: "Copa (mata-mata)", value: "copa" },
        { name: "Dos grupos", value: "dos_grupos" },
        { name: "Libertadores (grupos y eliminatorias)", value: "libertadores" }
      ))
    .addStringOption((o) => o.setName("tipo").setDescription("Liga en PRUEBAS; en servidores oficiales se detecta automáticamente").setRequired(false)
      .addChoices(
        { name: "ASH", value: "ash" },
        { name: "Haxole Exclusivo / Road to Glory", value: "exclusivo" },
        { name: "Haxole Temático", value: "tematico" }
      )),

  handleComponent: require("../utils/tournamentWizard").handle,

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const raw = interaction.sourceMessage?.content || "";
    const parsed = parseRaw(raw);
    const modalidad = roleRegistry.normalizeModality(interaction.options.getString("modalidad") || parsed.modalidad);
    const torneo = interaction.options.getString("torneo") || parsed.torneo;
    const requestedCount = interaction.options.getInteger("cantidad_equipos") || parsed.cantidad;
    const modo = (interaction.options.getString("modo") || parsed.modo || "liga").toLowerCase();
    const grouped = ["dos_grupos", "libertadores"].includes(modo);
    if (grouped && requestedCount) return interaction.reply({ content: "En formatos por grupos, omití cantidad_equipos y editá los grupos desde el panel de configuración.", flags: 64 });
    const cantidad = requestedCount || (modo === "libertadores" ? 32 : modo === "dos_grupos" ? 8 : 12);

    const requestedType = (interaction.options.getString("tipo") || parsed.tipo || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const serverType = tournamentScope.leagueForGuild(interaction.guildId || interaction.guild?.id);
    if (serverType && requestedType && requestedType !== serverType) {
      return interaction.reply({ content: `Este servidor corresponde a ${serverType.toUpperCase()}. No se puede crear un torneo de otra liga acá.`, flags: 64 });
    }
    const tipo = serverType || requestedType || tournamentScope.currentLeague();
    if (!["ash", "exclusivo", "tematico"].includes(tipo)) {
      return interaction.reply({ content: "No se pudo detectar la liga. Indicá tipo: ASH, Exclusivo o Temático para crear el torneo en PRUEBAS.", flags: 64 });
    }

    if (!modalidad) {
      return interaction.reply({ content: "Modalidad invalida.", flags: 64 });
    }
    if (!torneo) {
      return interaction.reply({ content: "Tenes que indicar el nombre del torneo.", flags: 64 });
    }

    try {
      return await require("../utils/tournamentWizard").begin(interaction, { modality: modalidad, name: torneo, count: cantidad, formato: modo, tipo });
    } catch (error) {
      return interaction.reply({ content: error.message, flags: 64 });
    }
  }
};
