const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const options = [
  { id: "autoNicknames", name: "Apodos automáticos", description: "Actualiza los apodos según club y modalidad." },
  { id: "clubRolesBelowPlayer", name: "Orden de roles", description: "Ubica los roles de clubes debajo del rol de jugador." },
  { id: "antiSpam", name: "Anti spam", description: "Banea y limpia mensajes en el canal anti spam configurado." }
];
const active = (cfg, key) => key === "antiSpam" ? Boolean(cfg.automation?.antiSpam?.enabled) : cfg.automation?.[key] !== false;
const permitted = (interaction, owner) => interaction.guild && interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) && (!owner || owner === interaction.user.id);
function view(interaction, action = "home") {
  const cfg = readConfig();
  const choices = action === "home" ? [{ label: "Activar", value: "activar" }, { label: "Desactivar", value: "desactivar" }] : options.filter((option) => active(cfg, option.id) !== (action === "activar")).map((option) => ({ label: option.name, description: option.description, value: option.id }));
  const embed = new EmbedBuilder().setColor(0x151821).setTitle("Configuración del servidor").setDescription(options.map((option) => `${active(cfg, option.id) ? "✅" : "➖"} **${option.name}** — ${option.description}`).join("\n"));
  if (!choices.length) embed.setFooter({ text: "No hay opciones para esta acción. Usá /configurar para volver." });
  return { embeds: [embed], components: choices.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`configurar:${interaction.user.id}:${action}`).setPlaceholder(action === "home" ? "Elegí una acción" : "Elegí una configuración").addOptions(choices))] : [] };
}
module.exports = {
  data: new SlashCommandBuilder().setName("configurar").setDescription("Abre la configuración interactiva del servidor").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption((option) => option.setName("canal_antispam").setDescription("Canal donde se aplica Anti spam")),
  async execute(interaction) {
    if (!permitted(interaction)) return interaction.reply({ content: "Solo administradores.", flags: 64 });
    const channel = interaction.options.getChannel("canal_antispam");
    if (channel) {
      if (!channel.isTextBased()) return interaction.reply({ content: "Elegí un canal de texto.", flags: 64 });
      const cfg = readConfig(); cfg.automation.antiSpam.channelId = channel.id; saveConfig(cfg);
    }
    return interaction.reply({ ...view(interaction), flags: 64 });
  },
  async handleSelect(interaction, [owner, action]) {
    if (!permitted(interaction, owner)) return interaction.reply({ content: "Este menú pertenece a otro administrador.", flags: 64 });
    const selected = interaction.values[0];
    if (action === "home" && ["activar", "desactivar"].includes(selected)) return interaction.update(view(interaction, selected));
    if (!["activar", "desactivar"].includes(action) || !options.some((option) => option.id === selected)) return;
    const cfg = readConfig();
    if (selected === "antiSpam") {
      if (action === "activar" && !cfg.automation.antiSpam.channelId) return interaction.reply({ content: "Primero elegí un canal con /configurar canal_antispam.", flags: 64 });
      cfg.automation.antiSpam.enabled = action === "activar";
    } else cfg.automation[selected] = action === "activar";
    saveConfig(cfg);
    return interaction.update(view(interaction, action));
  }
};
