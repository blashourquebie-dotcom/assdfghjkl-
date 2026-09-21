const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const commandAccess = require("../utils/commandAccess");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("permisosbot")
    .setDescription("Habilita usuarios no administradores para usar comandos del bot")
    .addSubcommand((sub) =>
      sub
        .setName("agregar")
        .setDescription("Autoriza a un usuario")
        .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario").setRequired(true)))
    .addSubcommand((sub) =>
      sub
        .setName("quitar")
        .setDescription("Quita la autorizacion de un usuario")
        .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario").setRequired(true)))
    .addSubcommand((sub) =>
      sub
        .setName("lista")
        .setDescription("Muestra usuarios autorizados")),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden cambiar permisos del bot.", flags: 64 });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "lista") {
      const users = commandAccess.listUserAccess(interaction.guild.id);
      const embed = new EmbedBuilder()
        .setTitle("## Permisos del bot")
        .setColor(0x2ecc71)
        .setDescription(users.length ? users.map((id) => `- <@${id}>`).join("\n") : "No hay usuarios autorizados.");
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const user = interaction.options.getUser("usuario");
    const enabled = sub === "agregar";
    commandAccess.setUserAccess(interaction.guild.id, user.id, enabled);
    return interaction.reply({
      content: enabled
        ? `OK. <@${user.id}> puede usar comandos del bot en este servidor.`
        : `OK. <@${user.id}> ya no tiene permisos extra del bot.`,
      flags: 64
    });
  }
};
