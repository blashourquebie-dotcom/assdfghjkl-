const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const locks = new Set();
const allowed = (interaction) => interaction.guild && interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
module.exports = {
  data: new SlashCommandBuilder().setName("vincularinformesaprobaciones").setDescription("Vincula este canal para aceptar o rechazar informes").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: "Solo administradores.", flags: 64 });
    const cfg = readConfig(); cfg.reportApprovalsChannelId = interaction.channelId; saveConfig(cfg);
    return interaction.reply({ content: "Canal de aprobaciones vinculado. Usá /vincularinformes en cada canal de recepción.", flags: 64 });
  },
  async handleComponent(interaction, [action, id]) {
    if (!allowed(interaction)) return interaction.reply({ content: "Solo administradores pueden aprobar o rechazar informes.", flags: 64 });
    const key = interaction.guildId + ":" + id;
    const item = readConfig().reportApprovalQueue?.[id];
    if (!item || item.approvalChannelId !== interaction.channelId || item.approvalMessageId !== interaction.message.id) return interaction.reply({ content: "Este informe no pertenece a este canal.", flags: 64 });
    if (!["accept", "reject"].includes(action) || item.status !== "pending" || locks.has(key)) return interaction.reply({ content: "Informe ya resuelto o en proceso.", flags: 64 });
    locks.add(key);
    try {
      await interaction.deferReply({ flags: 64 });
      let status = "rejected";
      if (action === "accept") {
        const channel = await interaction.guild.channels.fetch(item.sourceChannelId);
        if (!channel) throw new Error("El canal original ya no existe.");
        const adapter = {
          guild: interaction.guild, channel, member: interaction.member, user: interaction.user, client: interaction.client,
          deferred: true, replied: false, sourceMessage: null,
          options: { getString: (name) => ({ modalidad: item.modalidad, torneo: item.torneo, reporte: item.raw, informe: item.raw }[name] || null), getInteger: () => null },
          reply: async (payload) => { adapter.result = payload; return payload; },
          editReply: async (payload) => { adapter.result = payload; return payload; }
        };
        const result = await require("./cargarstat").execute(adapter);
        if (!result?.reportSaved) throw new Error(adapter.result?.content || "No se completó la carga del informe.");
        status = "accepted";
      }
      const cfg = readConfig();
      cfg.reportApprovalQueue[id] = { ...item, status, decidedBy: interaction.user.id, decidedAt: new Date().toISOString() };
      saveConfig(cfg);
      await interaction.message.edit({ components: [] });
      return interaction.editReply({ content: status === "accepted" ? "Informe aprobado y cargado." : "Informe rechazado. No se publicó." });
    } catch (error) {
      return interaction.editReply({ content: ("No se completó la aprobación: " + error.message).slice(0, 3900) });
    } finally { locks.delete(key); }
  }
};
