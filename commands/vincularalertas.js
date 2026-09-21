const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { setAlertChannel } = require("../utils/alerts");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vincularalertas")
    .setDescription("Vincula el canal donde el bot avisa intentos no permitidos")
    .addChannelOption((o) =>
      o.setName("canal")
        .setDescription("Canal de alertas")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const channel = interaction.options.getChannel("canal") || interaction.channel;
    setAlertChannel(interaction.guild.id, channel.id);

    const embed = new EmbedBuilder()
      .setTitle("\u2705 Canal de alertas vinculado")
      .setDescription("A partir de ahora voy a registrar aca los intentos no permitidos y las acciones sensibles hechas por CAPs.")
      .addFields({ name: "\uD83D\uDCE3 Canal", value: `<#${channel.id}>`, inline: true })
      .setColor(0x2ecc71)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};
