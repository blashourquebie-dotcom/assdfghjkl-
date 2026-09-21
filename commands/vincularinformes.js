const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const haxoleSupabase = require("../utils/haxoleSupabase");
const roleRegistry = require("../utils/roleRegistry");

const parseRaw = (raw) => {
  const body = String(raw || "").trim().replace(/^\S+\s*/, "").trim();
  if (!body) return {};
  const getNamed = (key) => {
    const match = body.match(new RegExp(`(?:^|[\\s,;])${key}\\s*[:=]\\s*([^,;]+)`, "i"));
    return match ? match[1].trim() : null;
  };
  const parts = body.split(/\s+/).filter(Boolean);
  return {
    modalidad: getNamed("modalidad") || parts[0] || null,
    torneo: getNamed("torneo") || getNamed("nombre") || parts.slice(1).join(" ") || null
  };
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vincularinformes")
    .setDescription("Vincula un hilo con un torneo")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("torneo").setDescription("Nombre del torneo").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    if (!interaction.channel?.isTextBased?.()) {
      return interaction.reply({
        content: "Este comando ahora solo se puede usar dentro de un hilo del torneo. Abrí o usá el post del foro correspondiente.",
        flags: 64
      });
    }

    const raw = interaction.sourceMessage?.content || "";
    const parsed = parseRaw(raw);
    const modalidad = roleRegistry.normalizeModality(interaction.options.getString("modalidad") || parsed.modalidad);
    const torneoName = interaction.options.getString("torneo") || parsed.torneo;
    if (!modalidad || !torneoName) {
      return interaction.reply({ content: "Modalidad o torneo invalido.", flags: 64 });
    }

    const linked = await haxoleSupabase.setTournamentForumLink({
      modality: modalidad,
      name: torneoName,
      channelId: interaction.channel.id,
      messageId: interaction.sourceMessage?.id || null,
      guildId: interaction.guild.id
    });

    if (!linked) {
      return interaction.reply({ content: "No pude vincular el informe. Verifica que el torneo exista.", flags: 64 });
    }

    const { readConfig, saveConfig } = require("../utils/database");
    const cfg = readConfig();
    cfg.reportSources ||= {};
    cfg.reportSources[interaction.channel.id] = { modalidad, torneo: linked.nombre };
    saveConfig(cfg);
    return interaction.reply({
      content: `✅ Canal vinculado al torneo **${linked.nombre}** (${modalidad}).`,
      flags: 64
    });
  }
};
