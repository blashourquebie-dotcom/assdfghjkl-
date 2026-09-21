const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { reconcileClubRosterFromRoles, updateLinkedForumTemplates } = require("../utils/plantillas");

const parseModalities = (raw) => {
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw)
        .replace(/\s+/g, ",")
        .split(",")
        .map((mod) => roleRegistry.normalizeModality(mod))
        .filter(Boolean)
    )
  );
};

const gatherAllClubModalities = (cfg) => {
  const modalities = new Set();

  for (const club of Object.values(cfg.clubs || {})) {
    if (!club || typeof club !== "object") continue;
    for (const mod of Object.keys(club.roles || {})) {
      const normalized = roleRegistry.normalizeModality(mod);
      if (normalized) modalities.add(normalized);
    }
  }

  for (const mod of cfg.enabledModalities || []) {
    const normalized = roleRegistry.normalizeModality(mod);
    if (normalized) modalities.add(normalized);
  }

  return Array.from(modalities);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sincronizarroles")
    .setDescription("Sincroniza todos los roles actuales con Supabase y las plantillas vinculadas")
    .addStringOption((opt) =>
      opt
        .setName("modalidades")
        .setDescription("Opcional: modalidades separadas por coma; vacio = todas las conocidas")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const cfg = readConfig();
    const guild = interaction.guild;
    const requested = parseModalities(interaction.options.getString("modalidades"));
    const available = gatherAllClubModalities(cfg);
    const modalities = requested.length ? available.filter((mod) => requested.includes(mod)) : available;

    if (!modalities.length) {
      return interaction.reply({ content: "No encontre modalidades para sincronizar.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    await guild.members.fetch().catch(() => null);

    let clubsProcessed = 0;
    let modalitiesProcessed = 0;
    let membersAdded = 0;
    let membersRemoved = 0;
    let templatesUpdated = 0;

    for (const clubEntry of clubs.getAllClubs()) {
      const clubModalities = Object.keys(clubEntry.roles || {})
        .map((mod) => roleRegistry.normalizeModality(mod))
        .filter((mod) => mod && modalities.includes(mod));

      if (!clubModalities.length) continue;
      clubsProcessed += 1;

      for (const modality of clubModalities) {
        const syncResult = await reconcileClubRosterFromRoles(guild, clubEntry, modality).catch(() => null);
        if (syncResult) {
          modalitiesProcessed += 1;
          membersAdded += Number(syncResult.added) || 0;
          membersRemoved += Number(syncResult.removed) || 0;
        }

        const updated = await updateLinkedForumTemplates(guild, clubEntry.name, modality).catch(() => []);
        templatesUpdated += Array.isArray(updated) ? updated.length : 0;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("Sincronizacion total completada")
      .setColor(0x2ecc71)
      .setDescription([
        `Modalidades procesadas: **${modalities.join(", ")}**`,
        `Clubes recorridos: **${clubsProcessed}**`,
        `Modalidades sincronizadas: **${modalitiesProcessed}**`,
        `Miembros agregados: **${membersAdded}**`,
        `Miembros removidos: **${membersRemoved}**`,
        `Plantillas actualizadas: **${templatesUpdated}**`
      ].join("\n"));

    return interaction.editReply({ embeds: [embed] });
  }
};
