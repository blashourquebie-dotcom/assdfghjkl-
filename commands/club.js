const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { readUsers } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const validators = require("../utils/validators");

const DEFAULT_CLUB_EMOJI = "<:HaxOle:1495228748851839240>";
const CAPTAIN_EMOJI = "<:CAPITAN:1446933863795392674>";

const memberName = (member) =>
  member?.displayName || member?.user?.globalName || member?.user?.username || "";

const fetchMember = async (guild, userId) => {
  if (!guild || !userId) return null;
  return guild.members.fetch(userId).catch(() => null);
};

const uniqueMembers = (members) =>
  Array.from(new Map(members.filter(Boolean).map((member) => [member.id, member])).values());

module.exports = {
  data: new SlashCommandBuilder()
    .setName("club")
    .setDescription("Muestra jugadores y detalles de un club")
    .addStringOption((opt) =>
      opt
        .setName("club")
        .setDescription("Nombre o abreviacion del club")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    const clubQuery = interaction.options.getString("club");
    console.log(`[club] Mostrando club ${clubQuery} a ${interaction.user.tag}`);

    try {
      const clubEntry = clubs.findClub(clubQuery);
      if (!clubEntry) {
        return interaction.reply({ content: `Club **${clubQuery}** no encontrado.`, flags: 64 });
      }

      const clubEmoji = clubEntry.emoji || DEFAULT_CLUB_EMOJI;
      const embed = new EmbedBuilder()
        .setColor(clubEntry.color ? parseInt(String(clubEntry.color).replace(/^#/, ""), 16) : 0x00bcd4)
        .setTitle(`${clubEmoji} ${clubEntry.name} ${clubEmoji}`)
        .setFooter({ text: `Abreviacion: ${clubEntry.abbr || "SIN ABR"}` });

      if (clubEntry.shieldUrl) embed.setThumbnail(clubEntry.shieldUrl);

      const roles = Object.entries(clubEntry.roles || {})
        .map(([rawModality, roleId]) => ({
          modality: roleRegistry.normalizeModality(rawModality) || rawModality,
          roleId
        }))
        .filter((entry) => entry.roleId)
        .sort((a, b) => a.modality.localeCompare(b.modality, "es", { numeric: true }));

      if (!roles.length) {
        embed.setDescription("Este club no tiene roles vinculados.");
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      const users = readUsers();
      let totalPlayers = 0;

      for (const { modality, roleId } of roles) {
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        const captainId = clubEntry.captains?.[modality] || null;

        const dbIds = Object.entries(users)
          .filter(([, userData]) => userData?.clubRoles?.[modality] === roleId)
          .map(([userId]) => userId);

        const cachedRoleMembers = role ? Array.from(role.members.values()) : [];
        const fetchedMembers = await Promise.all(dbIds.map((userId) => fetchMember(interaction.guild, userId)));
        const captainMember = captainId ? await fetchMember(interaction.guild, captainId) : null;

        const members = uniqueMembers([...cachedRoleMembers, ...fetchedMembers, captainMember])
          .sort((a, b) => memberName(a).localeCompare(memberName(b), "es", { sensitivity: "base" }));

        const count = members.length;
        totalPlayers += count;

        const roleLimit = validators.getRoleLimit(roleId, modality);
        const limitText = roleLimit || "sin limite";
        const captainText = captainId ? `<@${captainId}> ${CAPTAIN_EMOJI}` : "sin capitan";
        const roleText = role ? `<@&${role.id}>` : `rol no encontrado (${roleId})`;

        const lines = members.length
          ? members.map((member) => {
              const capMark = captainId && member.id === captainId ? ` ${CAPTAIN_EMOJI}` : "";
              return `<@${member.id}>${capMark}`;
            })
          : ["sin jugadores"];

        embed.addFields({
          name: `${modality.toUpperCase()} - ${count}/${limitText}`,
          value: `Rol: ${roleText}\nCapitan: ${captainText}\nJugadores:\n${lines.join("\n")}`
        });
      }

      embed.addFields({ name: "Jugadores totales", value: String(totalPlayers), inline: true });

      return interaction.reply({ embeds: [embed], flags: 64 });
    } catch (error) {
      console.error("[club] Error:", error);
      return interaction.reply({ content: "Error al mostrar el club.", flags: 64 });
    }
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
      console.error("[club.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
