const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const officials = require("../utils/officials");
const { sendAlert } = require("../utils/alerts");

const formatLink = (link, index) => {
  const bits = [
    `**${index + 1}.** \`${link.auth}\``,
    link.reason ? `Razon: ${link.reason}` : null,
    link.addedBy ? `Agregado por: ${link.addedBy}` : null,
    link.createdAt ? `Fecha: <t:${Math.floor(new Date(link.createdAt).getTime() / 1000)}:R>` : null
  ].filter(Boolean);
  return bits.join("\n");
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("auths")
    .setDescription("Muestra tus auths vinculadas"),

  async execute(interaction) {
    const links = officials.getLinksForUser(interaction.guild.id, interaction.user.id);
    const isAdmin = interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator);

    const embed = new EmbedBuilder()
      .setColor(links.length ? 0x2ecc71 : 0xe67e22)
      .setTitle("Tus auths vinculadas")
      .setDescription(
        links.length
          ? [
              `**Usuario:** <@${interaction.user.id}>`,
              `**Total:** ${links.length}`,
              "",
              ...links.map((link, index) => formatLink(link, index))
            ].join("\n")
          : [
              `**Usuario:** <@${interaction.user.id}>`,
              "",
              "No tenes auths vinculadas todavia."
            ].join("\n")
      )
      .setFooter({ text: isAdmin ? "Modo admin activo" : "Consulta personal" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });

    await sendAlert(interaction.guild, {
      embeds: [{
        title: "Consulta de auths",
        description: `<@${interaction.user.id}> consulto sus auths vinculadas.`,
        color: 0x3498db
      }]
    }).catch(() => null);
  }
};
