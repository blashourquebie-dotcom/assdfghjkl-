const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const clubsUtil = require("../utils/clubs");

const selectedClubsByMessage = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clubsmod")
    .setDescription("Vista de moderador para gestionar clubes habilitados"),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "âŒ Solo administradores pueden usar este comando.", flags: 64 });
    }

    console.log(`[clubsmod] Mostrando gestiÃ³n de clubs a ${interaction.user.tag}`);

    const cfg = readConfig();
    const clubs = cfg.clubs || {};

    if (Object.keys(clubs).length === 0) {
      return interaction.reply({ content: "âš ï¸ No hay clubes registrados.", flags: 64 });
    }

    const embed = new EmbedBuilder()
      .setTitle("ðŸ› ï¸ GestiÃ³n de Clubes")
      .setDescription('Selecciona los clubes a eliminar del menÃº abajo. Luego presiona "Eliminar Seleccionados".')
      .setColor(0xFF6B6B);

    const options = Object.entries(clubs).map(([name, data]) => ({
      label: `${name} (${data.abbr})`.slice(0, 100),
      description: `Modalidades: ${Object.keys(data.roles || {}).join(", ")}`.slice(0, 100),
      value: name
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("clubsmod:select_clubs_to_delete")
      .setPlaceholder("Selecciona clubes a eliminar")
      .setMinValues(0)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("clubsmod:delete_selected_clubs")
        .setLabel("Eliminar Seleccionados")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row1, row2], flags: 64 });
  },

  async handleSelect(interaction, parts) {
    const action = parts[0];
    if (action === "select_clubs_to_delete") {
      const selected = interaction.values;
      selectedClubsByMessage.set(interaction.message.id, selected);

      const embed = EmbedBuilder.from(interaction.message.embeds[0]);
      embed.setDescription(
        `Selecciona los clubes a eliminar del menÃº abajo. Luego presiona "Eliminar Seleccionados".\n\n**Seleccionados:** ${selected.length > 0 ? selected.join(", ") : "Ninguno"}`
      );
      await interaction.update({ embeds: [embed] });
    }
  },

  async handleComponent(interaction, parts) {
    const action = parts[0];
    if (action === "delete_selected_clubs") {
      console.log(`[clubsmod] Eliminando clubs seleccionados por ${interaction.user.tag}`);

      const selectedClubs = selectedClubsByMessage.get(interaction.message.id) || [];
      if (!selectedClubs.length) {
        return interaction.reply({ content: "âš ï¸ No has seleccionado ningÃºn club.", flags: 64 });
      }

      const cfg = readConfig();
      const clubs = cfg.clubs || {};
      const deleted = [];

      for (const clubName of selectedClubs) {
        if (!clubs[clubName]) continue;

        if (!cfg.archivedClubs) cfg.archivedClubs = {};
        cfg.archivedClubs[clubName] = { ...clubs[clubName], archivedAt: new Date().toISOString() };
        clubsUtil.unregisterClub(clubName);
        deleted.push(clubName);
        console.log(`[clubsmod] Eliminado club: ${clubName}`);
      }

      saveConfig(cfg);
      selectedClubsByMessage.delete(interaction.message.id);

      const embed = new EmbedBuilder()
        .setTitle("âœ… Clubes Eliminados")
        .setDescription(`Eliminados: ${deleted.join(", ")}`)
        .setColor(0x2ECC71);

      await interaction.update({ embeds: [embed], components: [] });
    }
  }
};
