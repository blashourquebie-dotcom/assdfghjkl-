const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const officials = require("../utils/officials");
const { sendAlert } = require("../utils/alerts");

const buildLinksText = (links) => {
  if (!links.length) return "No hay auths vinculadas.";
  return links.map((link, index) => {
    return `**${index + 1}.** \`${link.auth}\``;
  }).join("\n");
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("validarauth")
    .setDescription("Vincula tu auth de Haxball a tu Discord")
    .addStringOption((o) => o.setName("auth").setDescription("Auth de HaxBall").setRequired(true))
    .addStringOption((o) => o.setName("razon").setDescription("Razon o etiqueta").setRequired(true)),

  async execute(interaction) {
    const auth = interaction.options.getString("auth");
    const reason = interaction.options.getString("razon");

    const result = officials.addAuthLink({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      auth,
      addedBy: interaction.user.tag,
      reason
    });

    if (!result.ok) {
      return interaction.reply({ content: result.error, flags: 64 });
    }

    const links = officials.getLinksForUser(interaction.guild.id, interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("Auth vinculada")
      .setDescription([
        `**Usuario:** <@${interaction.user.id}>`,
        `**Auth agregada:** \`${result.link.auth}\``,
        `**Razon:** ${reason}`,
        "",
        `**Total de auths vinculadas:** ${links.length}/3`,
        "",
        buildLinksText(links)
      ].join("\n"));

    await interaction.reply({ embeds: [embed], flags: 64 });

    // A player may link their auth while already waiting inside a host.
    for(const waiting of officials.listPendingSessions().filter(s=>s.status==='pending'&&s.auth===result.link.auth&&Date.now()-Date.parse(s.createdAt)<5*60*1000).slice(0,20)){
      await require('../handlers/webhookHandler').processOfficialPayload(interaction.client,{...waiting,autoValidation:waiting.autoValidationRequested===true},{guildId:waiting.guildId,channelId:waiting.channelId,source:'auth-linked'}).catch(error=>console.error('[auth-linked]',error.message));
    }

    await sendAlert(interaction.guild, {
      embeds: [{
        title: "Auth vinculada",
        description: [
          `Usuario: <@${interaction.user.id}>`,
          `Auth: \`${result.link.auth}\``,
          `Razon: ${reason}`,
          `Hecho por: <@${interaction.user.id}>`
        ].join("\n"),
        color: 0x2ecc71
      }]
    }).catch(() => null);
  },

  async handleComponent(interaction, parts) {
    const action = parts[0];
    const sessionId = parts[1];
    const session = officials.getPendingSession(sessionId);
    if (!session) {
      return interaction.reply({ content: "Esta validacion ya no existe o expiró.", flags: 64 });
    }

    if (session.status !== "pending" || Date.now() - new Date(session.createdAt).getTime() > 5 * 60 * 1000) return interaction.reply({ content: "Esta validación ya fue resuelta o expiró.", flags: 64 });
    if (interaction.guildId && String(interaction.guildId) !== String(session.guildId)) return interaction.reply({ content: "Esta validación pertenece a otro servidor.", flags: 64 });
    if (String(interaction.user.id) !== String(session.matchedUserId) && !interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "No sos la persona que debe validar esto.", flags: 64 });
    }

    if (action === "confirm") {
      await interaction.deferReply({flags:64});
      if (officials.getPendingSession(sessionId)?.status !== "pending") return interaction.editReply({content:"Esta verificación ya fue resuelta."});
      const confirmed = officials.updatePendingSession(sessionId, {
        status: "confirmed",
        reportingV2: true,
        confirmedAt: new Date().toISOString(),
        decidedBy: interaction.user.id
      });
      officials.addPlayerAlias({ guildId: session.guildId, userId: session.matchedUserId, playerName: session.playerName, source: "validation" });
      await require("../utils/antiDu").recordValidation(interaction.client, confirmed).catch((error) => console.error("[antiDu]", error.message));
      await interaction.message?.edit?.({ components: [] }).catch(() => null);
      const guild = await interaction.client.guilds.fetch(session.guildId).catch(() => null);
      if (guild) {
        await sendAlert(guild, {
          embeds: [{
            title: "Validacion oficial confirmada",
            description: `**${session.playerName}** fue validado por <@${interaction.user.id}>.`,
            color: 0x2ecc71
          }]
        }).catch(() => null);
      }
      return interaction.editReply({ content: "Validacion confirmada. Ya quedo registrada." });
    }

    if (action === "reject") {
      await interaction.deferReply({flags:64});
      if (officials.getPendingSession(sessionId)?.status !== "pending") return interaction.editReply({content:"Esta verificación ya fue resuelta."});
      officials.updatePendingSession(sessionId, {
        status: "rejected",
        rejectedAt: new Date().toISOString(),
        decidedBy: interaction.user.id
      });
      await interaction.message?.edit?.({ components: [] }).catch(() => null);
      const guild = await interaction.client.guilds.fetch(session.guildId).catch(() => null);
      if (guild) {
        await sendAlert(guild, {
          embeds: [{
            title: "Validacion oficial rechazada",
            description: `**${session.playerName}** fue rechazada por <@${interaction.user.id}>. Revisar manualmente.`,
            color: 0xe67e22
          }]
        }).catch(() => null);
      }
      return interaction.editReply({ content: "Validacion rechazada. Se notifico al staff." });
    }

    return interaction.reply({ content: "Accion no soportada.", flags: 64 });
  },

  buildValidationComponents(sessionId) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`validarauth:confirm:${sessionId}`)
          .setLabel("SI, SOY YO")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`validarauth:reject:${sessionId}`)
          .setLabel("NO, NO SOY YO")
          .setStyle(ButtonStyle.Danger)
      )
    ];
  }
};
