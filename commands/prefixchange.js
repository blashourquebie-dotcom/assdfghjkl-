const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("prefixchange")
    .setDescription("Cambia el prefijo de comandos con !")
    .addStringOption((opt) => opt.setName("prefijo").setDescription("Nuevo prefijo, ej: !").setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden cambiar el prefijo.", flags: 64 });
    }

    const prefix = String(interaction.options.getString("prefijo") || "").trim();
    if (!prefix || prefix.length > 5 || /\s/.test(prefix)) {
      return interaction.reply({ content: "Prefijo invalido. Usa 1 a 5 caracteres sin espacios.", flags: 64 });
    }

    const cfg = readConfig();
    cfg.meta = cfg.meta || {};
    cfg.meta.prefix = [prefix];
    saveConfig(cfg);

    return interaction.reply({ content: `✅ Prefijo actualizado a \`${prefix}\`.`, flags: 64 });
  }
};
