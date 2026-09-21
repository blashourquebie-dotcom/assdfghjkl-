const { withGuild, readConfig, saveConfig } = require("../utils/database");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const supabase = require("../utils/haxoleSupabase");
const loading = new Set();

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (!require('../utils/tournamentScope').allowedGuild(message.guild?.id)) return;
    if (!message.guild || message.author.bot || !/\d+\s*[-.xX]\s*\d+/.test(message.content)) return;
    const key = message.guildId + ":" + message.id;
    if (loading.has(key)) return;
    loading.add(key);
    try {
      await withGuild(message.guildId, async () => {
        let cfg = readConfig();
        if (!cfg.reportApprovalsChannelId || cfg.reportApprovalsChannelId === message.channelId) return;
        let source = cfg.reportSources?.[message.channelId];
        if (!source) {
          const tournament = await supabase.getTournamentByForumChannel(message.channelId);
          if (!tournament) return;
          const modality = await supabase.getModalidadById(tournament.modalidad_id);
          source = { torneo: tournament.nombre, modalidad: modality?.nombre };
        }
        if (!source.modalidad || !source.torneo || cfg.reportApprovalQueue?.[message.id]) return;
        const channel = await client.channels.fetch(cfg.reportApprovalsChannelId);
        if (channel?.guildId !== message.guildId || !channel.isTextBased()) return;
        const preview = await require("../commands/cargarstat").previewReport(message.content, message.guildId);
        const embed = new EmbedBuilder().setColor(0x151821).setTitle("Informe pendiente de aprobación")
          .setDescription((preview ? preview.description : "No se pudo interpretar el informe. Revisá el texto original antes de continuar.").slice(0, 3900))
          .addFields({ name: "Competencia", value: source.torneo + " · " + source.modalidad }, { name: "Enviado por", value: "<@" + message.author.id + "> · [Original](" + message.url + ")" });
        embed.setFooter({ text: "Revisá los datos antes de aprobar. Informe completo en el archivo adjunto." });
        const components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("vincularinformesaprobaciones:accept:" + message.id).setLabel("Aceptar").setStyle(ButtonStyle.Success).setDisabled(!preview?.valid),
          new ButtonBuilder().setCustomId("vincularinformesaprobaciones:reject:" + message.id).setLabel("Rechazar").setStyle(ButtonStyle.Danger)
        )];
        const sent = await channel.send({ embeds: [embed], components, files: [new AttachmentBuilder(Buffer.from(message.content), { name: "informe.txt" })], allowedMentions: { parse: [] } });
        cfg = readConfig();
        cfg.reportApprovalQueue ||= {};
        cfg.reportApprovalQueue[message.id] = { ...source, raw: message.content, sourceChannelId: message.channelId, approvalChannelId: channel.id, approvalMessageId: sent.id, authorId: message.author.id, status: "pending", createdAt: new Date().toISOString() };
        saveConfig(cfg);
      });
    } catch (error) { console.error("[reportApproval]", error.message); }
    finally { loading.delete(key); }
  });
};
