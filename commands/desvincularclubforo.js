const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { readConfig, saveConfig } = require("../utils/database");
const { renderClubTemplate } = require("../utils/plantillas");

const isForumContext = (channel) => {
  return channel?.type === ChannelType.PublicThread && channel.parent?.type === ChannelType.GuildForum;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("desvincularclubforo")
    .setDescription("Desvincula un foro/post de un club")
    .addChannelOption((opt) => opt.setName("foro").setDescription("Post de foro a desvincular; vacio = este foro").setRequired(false))
    .addStringOption((opt) => opt.setName("club").setDescription("Opcional: desvincular todos los foros de este club").setRequired(false).setAutocomplete(true))
    .addStringOption((opt) => opt.setName("modalidad").setDescription("Opcional: modalidad del club").setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const channel = interaction.options.getChannel("foro") || interaction.channel;
    const clubQuery = interaction.options.getString("club");
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const cfg = readConfig();
    cfg.forumClubs = cfg.forumClubs || {};

    const removed = [];
    if (clubQuery) {
      const clubEntry = clubs.findClub(clubQuery);
      if (!clubEntry) return interaction.reply({ content: `No encontre el club **${clubQuery}**.`, flags: 64 });

      for (const [channelId, link] of Object.entries(cfg.forumClubs)) {
        const sameClub = String(link.club || "").toLowerCase() === String(clubEntry.name).toLowerCase();
        const sameMod = !modality || roleRegistry.normalizeModality(link.modality) === modality;
        if (!sameClub || !sameMod) continue;
        await markFundido(interaction.guild, channelId, link);
        removed.push({ channelId, link });
        delete cfg.forumClubs[channelId];
      }
    } else {
      if (!isForumContext(channel)) {
        return interaction.reply({ content: "Indica un club o ejecuta este comando dentro de un post de foro.", flags: 64 });
      }
      if (cfg.forumClubs[channel.id]) {
        await markFundido(interaction.guild, channel.id, cfg.forumClubs[channel.id]);
        removed.push({ channelId: channel.id, link: cfg.forumClubs[channel.id] });
        delete cfg.forumClubs[channel.id];
      }
    }

    saveConfig(cfg);
    return interaction.reply({
      content: removed.length
        ? `✅ Desvincule ${removed.length} foro(s): ${removed.map((item) => `<#${item.channelId}>`).join(", ")}`
        : "No habia vinculaciones para desvincular.",
      flags: 64
    });
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "club") return;
      const options = clubs.searchClubs(focused.value)
        .slice(0, 25)
        .map((club) => ({
          name: club.abbr ? `${club.name} (${club.abbr})` : club.name,
          value: club.name
        }));
      await interaction.respond(options);
    } catch (error) {
      console.error("[desvincularclubforo.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};

async function markFundido(guild, channelId, link) {
  if (!link?.messageId) return;
  const clubEntry = clubs.findClub(link.club);
  if (!clubEntry) return;
  const content = await renderClubTemplate(guild, clubEntry, link.modality, { fundido: true }).catch(() => null);
  if (!content) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  const message = await channel?.messages?.fetch(link.messageId).catch(() => null);
  await message?.edit({ content }).catch(() => null);
}
