const { randomUUID } = require("node:crypto");
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../utils/haxoleSupabase");
const roleRegistry = require("../utils/roleRegistry");

const confirmations = new Map();
const TIMEOUT_MS = 5 * 60 * 1000;

const data = new SlashCommandBuilder()
  .setName("borrartorneo")
  .setDescription("Borra un torneo vacío de esta liga, con confirmación")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option.setName("modalidad").setDescription("Modalidad del torneo").setRequired(true))
  .addStringOption((option) => option.setName("torneo").setDescription("Nombre exacto del torneo").setRequired(true));

async function execute(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo administradores.", flags: 64 });
  const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
  const name = String(interaction.options.getString("torneo") || "").trim();
  if (!modality || !name) return interaction.reply({ content: "Indicá una modalidad y un torneo válidos.", flags: 64 });
  await interaction.deferReply({ flags: 64 });
  try {
    const inspected = await db.inspectTournamentRemoval({ modality, name });
    if (!inspected) return interaction.editReply({ content: `No encontré **${name}** en ${modality} dentro de esta liga.` });
    if (inspected.blockers.length) return interaction.editReply({ content: `No se borró **${inspected.torneo.nombre}**: tiene ${inspected.blockers.join(", ")}. Este comando solo borra torneos vacíos.` });
    const token = randomUUID();
    for (const [key, entry] of confirmations) if (entry.expires < Date.now()) confirmations.delete(key);
    confirmations.set(token, { owner: interaction.user.id, guild: interaction.guildId || interaction.guild?.id, modality, name: inspected.torneo.nombre, id: inspected.torneo.id, expires: Date.now() + TIMEOUT_MS });
    return interaction.editReply({ content: `¿Borrar **${inspected.torneo.nombre}** (${modality}) de esta liga? No tiene partidos, clubes inscriptos ni historial vinculado. Confirmá dentro de 5 minutos.`, components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`borrartorneo:confirm:${token}`).setLabel("Sí, borrar torneo").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`borrartorneo:cancel:${token}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
    )] });
  } catch (error) { return interaction.editReply({ content: error.message || "No se pudo verificar el torneo. No se borró nada." }); }
}

async function handleComponent(interaction, [action, token]) {
  const entry = confirmations.get(token);
  if (!entry || entry.expires < Date.now()) return interaction.reply({ content: "Confirmación vencida. Volvé a usar /borrartorneo.", flags: 64 });
  if (entry.owner !== interaction.user.id || entry.guild !== (interaction.guildId || interaction.guild?.id) || !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo el administrador que abrió este borrado puede confirmarlo.", flags: 64 });
  if (action === "cancel") { confirmations.delete(token); return interaction.update({ content: "Borrado cancelado.", components: [] }); }
  if (action !== "confirm") return interaction.reply({ content: "Acción desconocida.", flags: 64 });
  confirmations.delete(token);
  await interaction.deferUpdate();
  try {
    const inspected = await db.inspectTournamentRemoval({ modality: entry.modality, name: entry.name });
    if (!inspected || inspected.torneo.id !== entry.id) throw new Error("El torneo cambió. No se borró nada.");
    const removed = await db.removeTournament({ modality: entry.modality, name: entry.name });
    if (!removed || removed.id !== entry.id) throw new Error("No pude confirmar el borrado. Revisá Supabase.");
    return interaction.editReply({ content: `Torneo **${entry.name}** borrado de **${entry.modality}**.`, components: [] });
  } catch (error) { return interaction.editReply({ content: error.message || "No se pudo borrar el torneo.", components: [] }); }
}

module.exports = { data, execute, handleComponent };
