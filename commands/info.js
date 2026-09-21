const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { readConfig, readSanctions } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const { getBanner, footerTextFor, resolveServerUrl } = require("../utils/banners");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Muestra informacion general del bot y servidor"),

  async execute(interaction) {
    const cfg = readConfig();
    const sanctions = readSanctions();
    const guildSanctions = sanctions?.[interaction.guild.id] || {};
    const prefixes = cfg.meta?.prefix || ["!"];
    const modalities = roleRegistry.getEnabledModalities(cfg);
    const clubCount = Object.keys(cfg.clubs || {}).length;
    const forumCount = Object.keys(cfg.forumClubs || {}).length;
    const serverUrl = await resolveServerUrl(interaction);
    const footer = await footerTextFor(interaction);

    const content = [
      `# ${interaction.guild.name}`,
      "**HaxOle Bot** esta activo y sincronizado con este servidor.",
      "",
      "## Estado",
      `- **Clubes activos:** ${clubCount}`,
      `- **Modalidades:** ${modalities.length ? modalities.join(", ") : "ninguna"}`,
      `- **Foros vinculados:** ${forumCount}`,
      `- **Sanciones activas:** ${Object.keys(guildSanctions).length}`,
      `- **Prefijos:** ${prefixes.map((p) => `\`${p}\``).join(" ")}`,
      "",
      "## Accesos rapidos",
      "- `!help` comandos disponibles",
      "- `!pe` nacionalidad peruana",
      "- `!bo` nacionalidad boliviana",
      "- `!tiers` ranking de puntos",
      "- Web local: `http://localhost:3000`",
      "",
      `**${interaction.guild.name}** \`|\` ${serverUrl || "invite no disponible"}`
    ].join("\n");

    const banner = getBanner("info");
    const embed = new EmbedBuilder()
      .setColor(0xb0091c)
      .setImage(banner.url)
      .setDescription(content.slice(0, 4096))
      .setFooter({ text: footer });

    return interaction.reply({ embeds: [embed], files: [banner.attachment], flags: 64 });
  }
};
