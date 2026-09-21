const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const { collectManagedRoleIds } = require("../utils/clubRoleRecovery");

const PASSWORD = "252725";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("eliminartodoslosroles")
    .setDescription("Elimina todos los roles administrados por el bot en este servidor")
    .addStringOption((opt) =>
      opt
        .setName("contrasena")
        .setDescription("Contraseña de seguridad")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const password = interaction.options.getString("contrasena");
    if (String(password || "").trim() !== PASSWORD) {
      return interaction.reply({ content: "Contraseña incorrecta.", flags: 64 });
    }

    const cfg = readConfig();
    const roleIds = collectManagedRoleIds(cfg, interaction.guild.id);
    if (!roleIds.length) {
      return interaction.reply({ content: "No encontre roles administrados para borrar.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    await interaction.guild.members.fetch().catch(() => null);

    let deleted = 0;
    let failed = 0;
    const failedNames = [];

    for (const roleId of roleIds) {
      const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;
      try {
        await role.delete("Eliminacion masiva por /eliminartodoslosroles");
        deleted += 1;
      } catch (error) {
        failed += 1;
        failedNames.push(role.name);
        console.log(`[eliminartodoslosroles] No se pudo borrar ${role.name}: ${error.message}`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("Roles eliminados")
      .setColor(failed ? 0xf1c40f : 0x2ecc71)
      .setDescription([
        `Roles objetivo: **${roleIds.length}**`,
        `Eliminados: **${deleted}**`,
        `Fallidos: **${failed}**`,
        failedNames.length ? `No borrados: ${failedNames.slice(0, 12).join(", ")}` : null,
        "Despues de esto usa `/relinkclubes` para recrearlos y volver a vincularlos."
      ].filter(Boolean).join("\n"));

    return interaction.editReply({ embeds: [embed] });
  }
};
