const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const { sendCapActionAlert } = require("../utils/alerts");
const { updateLinkedForumTemplates } = require("../utils/plantillas");
const { sendTempInteractionReply } = require("../utils/tempMessage");
const haxoleSupabase = require("../utils/haxoleSupabase");

const TEMP_REPLY_MS = 10000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vinclub")
    .setDescription("Vincula un emoji a un club habilitado")
    .addStringOption((opt) =>
      opt.setName("club")
        .setDescription("Club habilitado")
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption((opt) =>
      opt.setName("emoji")
        .setDescription("Emoji del escudo, por ejemplo <:SCS:123456789>")
        .setRequired(true)),

  async execute(interaction) {
    const clubQuery = interaction.options.getString("club");
    const emoji = interaction.options.getString("emoji")?.trim();
    const clubEntry = clubs.findClub(clubQuery);

    if (!clubEntry) {
      return sendTempInteractionReply(interaction, {
        content: `No encontre el club **${clubQuery}**.`,
        flags: 64
      }, TEMP_REPLY_MS);
    }
    if (!emoji) return interaction.reply({ content: "Tenes que indicar un emoji valido.", flags: 64 });

    const cfg = readConfig();
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const captainMods = Object.entries(cfg.clubs?.[clubEntry.name]?.captains || {})
      .filter(([, userId]) => String(userId) === interaction.user.id)
      .map(([mod]) => mod);

    if (!isAdmin && !captainMods.length) {
      return interaction.reply({ content: "Solo administradores o CAPs vinculados a este club pueden cambiar el emoji.", flags: 64 });
    }

    clubs.setClubEmoji(clubEntry.name, emoji);
    if (haxoleSupabase.isEnabled) {
      await haxoleSupabase.ensureClubRow(clubEntry.name, {
        emoji,
        capitan: cfg.clubs?.[clubEntry.name]?.captains ? Object.values(cfg.clubs[clubEntry.name].captains)[0] || null : null
      }).catch((error) => {
        console.error("[vinclub] Error sincronizando club en Supabase:", error);
      });
    }
    for (const mod of Object.keys(clubEntry.roles || {})) {
      await updateLinkedForumTemplates(interaction.guild, clubEntry.name, mod).catch(() => null);
    }

    await sendCapActionAlert(interaction, {
      action: "Vinculo emoji de club",
      club: clubEntry.name,
      modality: captainMods.join(", "),
      targets: [interaction.user.id],
      details: `**Emoji:** ${emoji}`
    }).catch(() => null);

    return sendTempInteractionReply(interaction, {
      content: `✅ Emoji vinculado.\n**Club:** ${clubEntry.name}\n**Emoji:** ${emoji}`,
      flags: 64
    }, TEMP_REPLY_MS);
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "club") return;

      const filtered = clubs.searchClubs(focused.value)
        .slice(0, 25)
        .map((club) => ({
          name: club.abbr ? `${club.name} (${club.abbr})` : club.name,
          value: club.name
        }));

      await interaction.respond(filtered);
    } catch (error) {
      console.error("[vinclub.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
