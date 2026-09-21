const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { isClubStaff } = require("../utils/clubPermissions");
const { sendAlert } = require("../utils/alerts");

const hasImage = (message) =>
  message.attachments?.some((attachment) => String(attachment.contentType || "").startsWith("image/"));

const startsWithProtectedLetter = (message) => /^[cf]/i.test(String(message.content || "").trim());

const isPendingTransferMessage = (message, cfg) => {
  const pending = cfg.pendingTransfers?.[message.id];
  if (!pending) return false;
  return String(pending.channelId || "") === String(message.channel?.id || message.channelId || "");
};

const formatDeletedMessage = (message) => {
  const authorName = message.member?.displayName || message.author?.globalName || message.author?.username || message.author?.tag || "Usuario";
  const content = String(message.content || "").trim();
  const attachments = message.attachments?.size
    ? Array.from(message.attachments.values()).map((attachment) => attachment.url).filter(Boolean)
    : [];
  const body = [
    content || "(sin texto)",
    ...attachments.map((url) => `[archivo](${url})`)
  ].join(" ");
  return `**${authorName}:** ${body.slice(0, 500)}`;
};

const chunkLines = (lines, maxLength = 3500) => {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const sendClearLog = async (interaction, { clubEntry, modality, deletedMessages }) => {
  if (!deletedMessages.length) return false;

  const clubEmoji = clubEntry.emoji || "\uD83C\uDFC6";
  const chunks = chunkLines(deletedMessages);
  for (let index = 0; index < chunks.length; index += 10) {
    const embeds = chunks.slice(index, index + 10).map((chunk, offset) => {
      const page = index + offset + 1;
      const embed = new EmbedBuilder()
        .setTitle(page === 1 ? "\uD83D\uDCCB Accion de CAP registrada" : "\uD83D\uDCCB Mensajes borrados")
        .setDescription(chunk)
        .setColor(0xe67e22)
        .setTimestamp();

      if (page === 1) {
        embed.addFields(
          { name: "\uD83D\uDC64 CAP/Admin", value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
          { name: "\u2699\uFE0F Accion", value: "clear", inline: true },
          { name: "\uD83C\uDFC6 Club", value: `${clubEmoji} ${clubEntry.name} (${modality})`, inline: true },
          { name: "\uD83D\uDCCD Canal", value: `<#${interaction.channel.id}>`, inline: true }
        );
      }

      return embed;
    });

    await sendAlert(interaction.guild, { embeds }).catch(() => null);
  }

  return true;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Limpia mensajes del foro preservando portada, plantilla y firmas/cancelaciones")
    .addStringOption((opt) =>
      opt.setName("modo").setDescription("Usa all para borrar tambien mensajes que empiezan con c/f").setRequired(false)
    ),

  async execute(interaction) {
    const cfg = readConfig();
    const link = cfg.forumClubs?.[interaction.channel?.id];
    if (!link) {
      return interaction.reply({ content: "Este canal no esta vinculado a ningun club.", flags: 64 });
    }

    const clubEntry = clubs.findClub(link.club);
    const modality = roleRegistry.normalizeModality(link.modality);
    if (!clubEntry || !modality) {
      return interaction.reply({ content: "La vinculacion de este foro esta incompleta.", flags: 64 });
    }

    const mode = String(interaction.options.getString("modo") || "").toLowerCase();
    const clearAll = mode === "all";
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const isStaff = isClubStaff(cfg, clubEntry.name, modality, interaction.user.id);

    if (clearAll && !isAdmin) {
      return interaction.reply({ content: "`!clear all` es solo para administradores.", flags: 64 });
    }
    if (!isAdmin && !isStaff) {
      return interaction.reply({ content: "Solo admins o CAP/SC de este club pueden usar `!clear`.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 }).catch(() => null);

    const fetched = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) {
      return interaction.editReply({ content: "No pude leer mensajes del foro. Revisa permisos del bot." });
    }

    const deletedMessages = [];
    let deleted = 0;
    let kept = 0;

    for (const message of fetched.values()) {
      const isSourceMessage = interaction.sourceMessage?.id && String(message.id) === String(interaction.sourceMessage.id);
      const isTemplate = link.messageId && String(message.id) === String(link.messageId);
      const keep = isSourceMessage
        || isTemplate
        || isPendingTransferMessage(message, cfg)
        || hasImage(message)
        || (!clearAll && startsWithProtectedLetter(message));
      if (keep) {
        kept += 1;
        continue;
      }

      const ok = await message.delete().then(() => true).catch(() => false);
      if (ok) {
        deleted += 1;
        deletedMessages.push(formatDeletedMessage(message));
      }
    }

    await sendClearLog(interaction, { clubEntry, modality, deletedMessages }).catch(() => null);

    return interaction.editReply({
      content: [
        `Limpieza lista en **${clubEntry.name} ${modality}**.`,
        `Eliminados: **${deleted}**`,
        `Preservados: **${kept}**`
      ].join("\n")
    });
  }
};
