const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const officials = require("../utils/officials");
const { sendAlert } = require("../utils/alerts");

const splitAuths = (raw) => String(raw || "")
  .split(/[,;\n]+/)
  .map((part) => part.trim())
  .filter(Boolean);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("eliminarauth")
    .setDescription("Elimina una o varias auths vinculadas a un Discord")
    .addStringOption((o) => o.setName("auths").setDescription("Lista de auths separadas por coma").setRequired(true))
    .addUserOption((o) => o.setName("usuario").setDescription("Usuario a afectar; vacio = vos").setRequired(false))
    .addStringOption((o) => o.setName("razon").setDescription("Razon opcional").setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser("usuario") || interaction.user;
    const isAdmin = interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator);
    if (String(targetUser.id) !== String(interaction.user.id) && !isAdmin) {
      return interaction.reply({ content: "Solo un admin puede eliminar auths de otro usuario.", flags: 64 });
    }

    const auths = splitAuths(interaction.options.getString("auths"));
    const reason = interaction.options.getString("razon");
    if (!auths.length) {
      return interaction.reply({ content: "No pude leer ninguna auth valida.", flags: 64 });
    }

    const removed = [];
    const errors = [];
    for (const auth of auths) {
      const result = officials.removeAuthLink({
        guildId: interaction.guild.id,
        userId: targetUser.id,
        auth
      });
      if (result.ok) removed.push(auth);
      else errors.push(`${auth}: ${result.error}`);
    }

    const embed = new EmbedBuilder()
      .setColor(removed.length ? 0xe67e22 : 0xe74c3c)
      .setTitle("Auth eliminada")
      .setDescription([
        `**Usuario:** <@${targetUser.id}>`,
        removed.length ? `**Auths eliminadas:** ${removed.map((auth) => `\`${auth}\``).join(", ")}` : null,
        errors.length ? `**Errores:**\n${errors.map((line) => `• ${line}`).join("\n")}` : null,
        reason ? `**Razon:** ${reason}` : null
      ].filter(Boolean).join("\n"))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });

    await sendAlert(interaction.guild, {
      embeds: [{
        title: "Auth eliminada",
        description: [
          `Usuario: <@${targetUser.id}>`,
          removed.length ? `Auths: ${removed.map((auth) => `\`${auth}\``).join(", ")}` : null,
          reason ? `Razon: ${reason}` : null,
          `Hecho por: <@${interaction.user.id}>`
        ].filter(Boolean).join("\n"),
        color: 0xe67e22
      }]
    }).catch(() => null);
  }
};
