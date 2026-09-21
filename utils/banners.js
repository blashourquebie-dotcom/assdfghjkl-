const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { readConfig } = require("./database");

const BANNER_DIR = path.join(__dirname, "..", "assets", "banners");

const BANNERS = {
  help: "HELP.png",
  info: "INFO.png",
  lock: "LOCK.png",
  support: "SUPPORT.png",
  tickets: "TICKETS.png",
  unlock: "UNLOCK.png"
};

const getBanner = (key) => {
  const configuredName = BANNERS[key];
  if (!configuredName) return null;
  const fileName = fs.existsSync(path.join(BANNER_DIR, configuredName)) ? configuredName : "HELP.png";
  return {
    fileName,
    attachment: new AttachmentBuilder(path.join(BANNER_DIR, fileName), { name: fileName }),
    url: `attachment://${fileName}`
  };
};

const getServerUrl = (guild) => {
  const cfg = readConfig();
  const configured = cfg.meta?.serverInvite || cfg.meta?.serverUrl || cfg.meta?.discordInvite || cfg.meta?.discord;
  if (configured) return String(configured);
  if (guild?.vanityURLCode) return `https://discord.gg/${guild.vanityURLCode}`;
  const saved = cfg.meta?.serverInvites?.[guild?.id];
  if (saved) return String(saved);
  return null;
};

const resolveServerUrl = async (interaction) => {
  const existing = getServerUrl(interaction.guild);
  if (existing) return existing;

  const channel = interaction.channel;
  if (!channel?.createInvite) return null;

  const invite = await channel.createInvite({
    maxAge: 0,
    maxUses: 0,
    unique: false,
    reason: "Invite permanente para footers del bot"
  }).catch(() => null);
  if (!invite?.url) return null;

  const cfg = readConfig();
  if (!cfg.meta) cfg.meta = {};
  if (!cfg.meta.serverInvites) cfg.meta.serverInvites = {};
  cfg.meta.serverInvites[interaction.guild.id] = invite.url;
  require("./database").saveConfig(cfg);

  return invite.url;
};

const footerText = (guild) => {
  const url = getServerUrl(guild);
  return url ? `HaxOle | ${url}` : "HaxOle";
};

const footerTextFor = async (interaction) => {
  const url = await resolveServerUrl(interaction);
  return url ? `HaxOle | ${url}` : "HaxOle";
};

const buildBannerEmbed = (key, color = 0xb0091c) => {
  const banner = getBanner(key);
  if (!banner) return null;
  return {
    banner,
    embed: new EmbedBuilder().setColor(color).setImage(banner.url)
  };
};

module.exports = { getBanner, getServerUrl, resolveServerUrl, footerText, footerTextFor, buildBannerEmbed };
