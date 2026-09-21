const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const haxoleSupabase = require("../utils/haxoleSupabase");

const CONFIRMATION = "CONFIRMAR BORRADO TOTAL";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clearsupabase")
    .setDescription("Borra el estado de Supabase y deja el bot listo para arrancar de cero")
    .addStringOption((opt) =>
      opt
        .setName("confirmar")
        .setDescription(`Escribi exactamente: ${CONFIRMATION}`)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const confirm = String(interaction.options.getString("confirmar") || "").trim();
    if (confirm !== CONFIRMATION) {
      return interaction.reply({
        content: `Para ejecutar este comando tenes que escribir exactamente: **${CONFIRMATION}**`,
        flags: 64
      });
    }

    if (!haxoleSupabase.isEnabled) {
      return interaction.reply({
        content: "La integracion con Supabase no esta activa en este bot.",
        flags: 64
      });
    }

    await interaction.deferReply({ flags: 64 });

    const result = await haxoleSupabase.clearAllData().catch((error) => ({
      ok: false,
      tables: [],
      docs: [],
      error: String(error?.message || error)
    }));

    const failedTables = (result.tables || []).filter((entry) => !entry.ok);
    const failedDocs = (result.docs || []).filter((entry) => !entry.ok);

    const embed = new EmbedBuilder()
      .setTitle("Supabase reiniciado")
      .setColor(result.ok ? 0x2ecc71 : 0xe67e22)
      .setDescription([
        "Se limpio el estado del bot para arrancar de cero.",
        "",
        `Tablas procesadas: **${result.tables?.length || 0}**`,
        `Docs reiniciados: **${result.docs?.length || 0}**`,
        failedTables.length ? `Tablas con error: ${failedTables.map((entry) => `${entry.table}${entry.status ? ` (${entry.status})` : ""}`).join(", ")}` : null,
        failedDocs.length ? `Docs con error: ${failedDocs.map((entry) => entry.doc).join(", ")}` : null
      ].filter(Boolean).join("\n"));

    return interaction.editReply({ embeds: [embed] });
  }
};
