const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, withGuild } = require("../utils/database");
module.exports = {
  data: new SlashCommandBuilder().setName("vinvalidaciones").setDescription("Vincula este canal con validaciones Anti-DU y avisos de creación de salas").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!interaction.guild || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo administradores del servidor.", flags: 64 });
    if (!interaction.channel?.isTextBased()) return interaction.reply({ content: "Usá un canal de texto.", flags: 64 });
    withGuild(interaction.guild.id, () => { const cfg = readConfig(); cfg.validationChannelId = interaction.channelId; saveConfig(cfg); });
    return interaction.reply({ content: "Validaciones Anti-DU y avisos de creación de salas vinculados a este canal. El Discord del posible hoster se muestra en un aviso separado, sin IP ni conn. El canal debe ser privado para ver las coincidencias. Las alertas no sancionan automáticamente.", flags: 64 });
  }
};
