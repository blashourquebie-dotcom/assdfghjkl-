const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");
const validators = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("checklimit")
    .setDescription("Verifica roles de clubes que superan el limite de una modalidad")
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addStringOption((o) => o.setName("tipo").setDescription("club o sc").setRequired(false).addChoices(
      { name: "Clubes", value: "club" },
      { name: "Subcapitanes", value: "sc" }
    )),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const modalityRaw = interaction.options.getString("modalidad");
    const tipo = (interaction.options.getString("tipo") || "").toLowerCase();
    const modality = roleRegistry.normalizeModality(modalityRaw);
    const cfg = readConfig();

    if (tipo === "sc" || String(modalityRaw || "").toLowerCase().trim() === "sc") {
      const lines = Object.entries(cfg.clubs || {}).map(([clubName, club]) => {
        const modalities = modality ? [modality] : Object.keys(club?.roles || {}).map(roleRegistry.normalizeModality).filter(Boolean);
        return modalities.map((mod) => {
          const limit = Number(cfg.subcaptainLimits?.[mod] ?? cfg.subcaptainLimit ?? 1);
          const count = new Set([club?.subcaptains?.general, club?.subcaptains?.[mod]].filter(Boolean)).size;
          return `${limit <= 0 || count <= limit ? "✅" : "🚨"} ${clubName} ${mod}: ${count}/${limit > 0 ? limit : "sin limite"}`;
        }).join("\n");
      });
      return interaction.reply({
        content: `**Revision de limites SC**\n${(lines.join("\n") || "No hay clubes.").slice(0, 1900)}`,
        flags: 64
      });
    }

    if (!modality) return interaction.reply({ content: "Modalidad invalida. Usa algo como `x3`, `x4`, `x5` o `x7`.", flags: 64 });

    const rolesById = new Map();
    for (const entry of roleRegistry.getClubRoles(cfg, interaction.guild.id, modality)) {
      if (entry?.roleId) rolesById.set(entry.roleId, entry);
    }
    for (const [clubName, club] of Object.entries(cfg.clubs || {})) {
      const roleId = club?.roles?.[modality];
      if (roleId && !rolesById.has(roleId)) rolesById.set(roleId, { roleId, name: clubName });
    }
    const roles = Array.from(rolesById.values());
    if (!roles.length) return interaction.reply({ content: `No hay roles de clubes registrados en **${modality}**.`, flags: 64 });

    let allMembers;
    try {
      allMembers = await interaction.guild.members.fetch({ force: true, time: 30000 });
      if (!allMembers?.size || (interaction.guild.memberCount && allMembers.size < interaction.guild.memberCount)) throw new Error("lista incompleta");
    } catch {
      return interaction.reply({ content: "No pude cargar todos los miembros. No voy a mostrar un conteo incompleto; volve a intentar.", flags: 64 });
    }

    const lines = [];
    for (const entry of roles) {
      const role = await interaction.guild.roles.fetch(entry.roleId).catch(() => null);
      if (!role) {
        lines.push(`⚠️ ${entry.name || entry.roleId}: rol no encontrado`);
        continue;
      }

      const limit = validators.getRoleLimit(entry.roleId, modality);
      if (!limit) {
        lines.push(`⚠️ ${role.name}: sin limite`);
        continue;
      }

      const count = Array.from(allMembers.values()).filter((member) => member.roles.cache.has(role.id)).length;
      const ok = count <= limit;
      lines.push(`${ok ? "✅" : "🚨"} ${role.name}: ${count}/${limit}`);
    }

    return interaction.reply({
      content: `**Revision de limites: ${modality}**\n${lines.join("\n").slice(0, 1900)}`,
      flags: 64
    });
  }
};
