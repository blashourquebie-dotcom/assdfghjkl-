const { ChannelType, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");

const isForumPost = (channel) =>
  channel?.isThread?.() && channel.parent?.type === ChannelType.GuildForum;

const hasImageContent = (message) => {
  if (message.attachments?.size) {
    return message.attachments.some((attachment) =>
      String(attachment.contentType || "").startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(String(attachment.name || attachment.url || ""))
    );
  }
  return message.embeds?.some((embed) => embed.image || embed.thumbnail) || false;
};

const isAutomaticTemplateMessage = (message) => {
  const cfg = readConfig();
  const channelId = String(message.channelId || message.channel?.id || "");
  const link = cfg.forumClubs?.[channelId];
  if (link?.messageId && String(link.messageId) === String(message.id)) return true;
  const content = String(message.content || "");
  return Boolean(message.author?.bot && (
    (content.includes("-# Comandos de foro:") && content.includes("-# Usa `!ar`")) ||
    content.includes("-# Capitan comandos:")
  ));
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Borra mensajes recientes del canal")
    .addIntegerOption((opt) => opt.setName("cantidad").setDescription("Cantidad de mensajes, 1 a 100").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: "Necesitas permiso de gestionar mensajes.", flags: 64 });
    }

    const amount = interaction.options.getInteger("cantidad");
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return interaction.reply({ content: "La cantidad debe estar entre 1 y 100.", flags: 64 });
    }
    if (!interaction.channel?.bulkDelete) {
      return interaction.reply({ content: "No puedo borrar mensajes en este canal.", flags: 64 });
    }

    let deleted = null;
    if (isForumPost(interaction.channel)) {
      const fetched = await interaction.channel.messages.fetch({ limit: Math.min(amount + 10, 100) }).catch((error) => {
        console.error("[purge] Fetch error:", error);
        return null;
      });
      if (!fetched) return interaction.reply({ content: "No pude revisar mensajes para borrar.", flags: 64 });
      const candidates = fetched
        .filter((msg) => msg.id !== interaction.sourceMessage?.id)
        .filter((msg) => !hasImageContent(msg))
        .filter((msg) => !isAutomaticTemplateMessage(msg))
        .first(amount);
      deleted = candidates.length
        ? await interaction.channel.bulkDelete(candidates, true).catch((error) => {
          console.error("[purge] Error:", error);
          return null;
        })
        : new Map();
    } else {
      deleted = await interaction.channel.bulkDelete(amount, true).catch((error) => {
        console.error("[purge] Error:", error);
        return null;
      });
    }

    if (!deleted) return interaction.reply({ content: "No pude borrar mensajes. Revisa permisos del bot.", flags: 64 });
    if (interaction.sourceMessage) {
      const notice = await interaction.channel.send({ content: `✅ Borrados ${deleted.size} mensaje(s).` }).catch(() => null);
      if (notice?.delete) setTimeout(() => notice.delete().catch(() => null), 5000);
      return notice;
    }
    return interaction.reply({ content: `✅ Borrados ${deleted.size} mensaje(s).`, flags: 64 });
  }
};
