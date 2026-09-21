const { PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("./database");
const clubs = require("./clubs");
const roleRegistry = require("./roleRegistry");
const divisions = require("./divisions");

const getLinkedClubContext = (interaction) => {
  const cfg = readConfig();
  const link = cfg.forumClubs?.[interaction.channel.id];
  if (!link) return { error: "Este canal no esta vinculado. Usa `/foroclub` primero." };

  const clubEntry = clubs.findClub(link.club);
  const modality = roleRegistry.normalizeModality(link.modality);
  if (!clubEntry || !modality) {
    return { error: "La vinculacion de este foro esta incompleta. Volve a usar `/foroclub`." };
  }

  return { cfg, link, clubEntry, modality };
};

const runDivisionChange = async (interaction, targetDivision, actionLabel) => {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Solo administradores pueden cambiar divisiones.", flags: 64 });
  }

  const context = getLinkedClubContext(interaction);
  if (context.error) return interaction.reply({ content: context.error, flags: 64 });

  const current = divisions.getClubDivision(context.cfg, context.clubEntry.name, context.modality);
  const target = divisions.normalizeDivision(targetDivision);
  if (!target) return interaction.reply({ content: "Division invalida.", flags: 64 });
  if (current === target) {
    return interaction.reply({
      content: `**${context.clubEntry.name} ${context.modality}** ya esta en **${target}**.`,
      flags: 64
    });
  }

  const result = await divisions.setClubDivisionAndSync(
    interaction.guild,
    context.clubEntry,
    context.modality,
    target
  );

  if (!result) {
    return interaction.reply({
      content: `No pude cambiar la division de **${context.clubEntry.name} ${context.modality}**.`,
      flags: 64
    });
  }

  return interaction.reply({
    content: [
      `✅ **${actionLabel}**`,
      `**Club:** ${result.club}`,
      `**Modalidad:** ${result.modality}`,
      `**Division:** ${current || "sin division"} -> ${result.division}`,
      `**Jugadores sincronizados:** ${result.synced}`
    ].join("\n"),
    flags: 64
  });
};

module.exports = {
  runDivisionChange,
  getLinkedClubContext
};
