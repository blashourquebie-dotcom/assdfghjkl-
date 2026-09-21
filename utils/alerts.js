const { EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("./database");
const clubs = require("./clubs");

const setAlertChannel = (guildId, channelId) => {
  const cfg = readConfig();
  if (!cfg.alertChannels) cfg.alertChannels = {};
  cfg.alertChannels[guildId] = channelId;
  saveConfig(cfg);
};

const cleanText = (value) => String(value || "")
  .replace(/^[\s#*\uD83D\uDCCB\u26A0\uFE0F\u2705\u274C-]+/, "")
  .trim();

const getClubEmoji = (clubName) => {
  const clubEntry = clubs.findClub(clubName);
  return clubEntry?.emoji || "\uD83C\uDFC6";
};

const buildAlertEmbedFromText = (content) => {
  const lines = String(content || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const title = cleanText(lines.shift() || "Alerta del bot") || "Alerta del bot";
  const fields = [];
  const description = [];

  for (const line of lines) {
    const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
    if (match) {
      fields.push({ name: cleanText(match[1]), value: match[2] || "-", inline: fields.length < 4 });
    } else {
      description.push(line);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`\uD83D\uDCE3 ${title}`)
    .setColor(0xb0091c)
    .setTimestamp();

  if (description.length) embed.setDescription(description.join("\n"));
  if (fields.length) embed.addFields(fields);
  return embed;
};

const sendAlert = async (guild, payload) => {
  const cfg = readConfig();
  const channelId = cfg.alertChannels?.[guild.id];
  if (!channelId) return false;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;

  if (payload?.embeds || payload?.content) {
    await channel.send(payload).catch(() => null);
    return true;
  }

  await channel.send({ embeds: [buildAlertEmbedFromText(payload)] }).catch(() => null);
  return true;
};

const formatActor = (interaction) => {
  return `${interaction.user.tag} (<@${interaction.user.id}>)`;
};

const sendCapActionAlert = async (interaction, { action, club, modality, targets = [], details = "" }) => {
  const targetText = targets.length ? targets.map((target) => `<@${target}>`).join(", ") : "sin usuarios";
  const embed = new EmbedBuilder()
    .setTitle("\uD83D\uDCCB Accion de CAP registrada")
    .setDescription(`${getClubEmoji(club)} **${club || "Club"}**${modality ? ` - **${modality}**` : ""}`)
    .addFields(
      { name: "\uD83D\uDC64 CAP/Admin", value: formatActor(interaction), inline: false },
      { name: "\u2699\uFE0F Accion", value: action || "-", inline: true },
      { name: "\uD83D\uDCCD Canal", value: `<#${interaction.channel.id}>`, inline: true },
      { name: "\uD83D\uDC65 Usuarios", value: targetText, inline: false }
    )
    .setColor(0x3498db)
    .setTimestamp();

  if (details) embed.addFields({ name: "\uD83D\uDCDD Detalles", value: details, inline: false });
  return sendAlert(interaction.guild, { embeds: [embed] });
};

module.exports = {
  setAlertChannel,
  sendAlert,
  sendCapActionAlert
};
