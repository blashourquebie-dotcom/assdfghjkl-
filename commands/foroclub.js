const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { renderClubTemplate, reconcileForumTemplate } = require("../utils/plantillas");

const isForumContext = (channel) => {
  return channel?.type === ChannelType.PublicThread && channel.parent?.type === ChannelType.GuildForum;
};

const hasImage = (message) => {
  if (message.attachments?.some((attachment) =>
    String(attachment.contentType || "").startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(attachment.name || attachment.url || ""))
  )) {
    return true;
  }

  return message.embeds?.some((embed) => embed.image || embed.thumbnail) || false;
};

const purgeNonImageMessages = async (channel, skipMessageIds = []) => {
  if (!channel?.messages?.fetch) return 0;

  let deleted = 0;
  let before;
  const skipIds = new Set(skipMessageIds.filter(Boolean).map(String));

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!messages?.size) break;

    const ordered = Array.from(messages.values()).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

    for (const msg of ordered) {
      if (skipIds.has(String(msg.id))) continue;
      if (hasImage(msg)) continue;
      await msg.delete().then(() => { deleted += 1; }).catch(() => null);
    }

    before = ordered[0]?.id;
    if (messages.size < 100) break;
  }

  return deleted;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("foroclub")
    .setDescription("Vincula este canal/foro a un club y deja una plantilla actualizable")
    .addStringOption((o) => o.setName("club").setDescription("Nombre o abreviacion del club").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }
    if (!isForumContext(interaction.channel)) {
      return interaction.reply({ content: "Este comando solo se puede usar dentro de un post de foro.", flags: 64 });
    }

    const clubQuery = interaction.options.getString("club");
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    const clubEntry = clubs.findClub(clubQuery);

    if (!clubEntry) return interaction.reply({ content: `No encontre el club **${clubQuery}**. Proba con el nombre completo o la abreviacion.`, flags: 64 });
    if (!modality) return interaction.reply({ content: "Modalidad invalida. Ejemplos validos: `x3`, `x4`, `x5`, `x7`.", flags: 64 });

    const content = await renderClubTemplate(interaction.guild, clubEntry, modality);
    if (!content) {
      return interaction.reply({ content: `**${clubEntry.name}** no tiene **${modality}** habilitado todavia.`, flags: 64 });
    }

    const previousLink = readConfig().forumClubs?.[interaction.channel.id];
    if (previousLink?.messageId) {
      const previousClub = clubs.findClub(previousLink.club);
      const previousModality = roleRegistry.normalizeModality(previousLink.modality);
      const previousRoleId = clubs.getRoleForClub(previousClub, previousModality);
      const nextRoleId = clubs.getRoleForClub(clubEntry, modality);
      if (previousRoleId && previousRoleId !== nextRoleId) {
        const previousMessage = await interaction.channel.messages.fetch(previousLink.messageId).catch(() => null);
        await previousMessage?.delete?.().catch(() => null);
      }
    }

    const message = await reconcileForumTemplate(interaction.guild, interaction.channel, clubEntry, modality, {
      preferredMessageId: previousLink?.messageId,
      keepNewest: true
    });
    if (!message) {
      return interaction.reply({ content: "No pude crear o actualizar la plantilla automatica.", flags: 64 });
    }

    await purgeNonImageMessages(interaction.channel, [message.id]);

    return interaction.reply({
      content: [
        "✅ **Foro vinculado**",
        `**Club:** ${clubEntry.name}`,
        `**Modalidad:** ${modality}`,
        "La plantilla de este canal se va a actualizar cuando haya fichajes, cancelaciones o cambios vinculados."
      ].join("\n"),
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
      console.error("[foroclub.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch {}
    }
  }
};
