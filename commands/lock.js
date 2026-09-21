const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getBanner, footerTextFor } = require("../utils/banners");

const formatDate = (date) => date.toLocaleString("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const titleName = (channel) => {
  const name = String(channel?.name || "general").replace(/-/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Bloquea el envio de mensajes en este canal"),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: "Necesitas permiso de gestionar canales.", flags: 64 });
    }
    if (!interaction.channel?.permissionOverwrites?.edit) {
      return interaction.reply({ content: "No puedo bloquear este canal.", flags: 64 });
    }

    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false
    }, { reason: `Canal bloqueado por ${interaction.user.tag}` });

    const name = titleName(interaction.channel);
    const banner = getBanner("lock");
    const footer = await footerTextFor(interaction);
    const embed = new EmbedBuilder()
      .setColor(0xb0091c)
      .setImage(banner.url)
      .setDescription([
        `${name} - Bloqueado`,
        `El ${name.toLowerCase()} ahora se encuentra deshabilitado para todos los usuarios.`,
        "",
        `Bloqueado por: ${interaction.member?.displayName || interaction.user.username}.`,
        `Fecha: ${formatDate(new Date())}.`
      ].join("\n"))
      .setFooter({ text: footer });

    return interaction.reply({ embeds: [embed], files: [banner.attachment] });
  }
};
