const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const tournamentScope = require("../utils/tournamentScope");
const db = require("../utils/haxoleSupabase");

const leaguePaths = { ash: "ash", exclusivo: "haxole-roadtoglory", tematico: "haxole-tematico" };

module.exports = {
  data: new SlashCommandBuilder()
    .setName("verificarclub")
    .setDescription("Revisa si un club y modalidad están vinculados a esta liga y a la web")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName("club").setDescription("Nombre o abreviación del club").setRequired(true))
    .addStringOption((option) => option.setName("modalidad").setDescription("Modalidad, por ejemplo x3").setRequired(true))
    .addBooleanOption((option) => option.setName("reparar").setDescription("Crear la ficha web si falta; no modifica roles ni logos existentes")),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo administradores.", flags: 64 });
    const modality = roleRegistry.normalizeModality(interaction.options.getString("modalidad"));
    if (!modality) return interaction.reply({ content: "Modalidad inválida.", flags: 64 });
    const league = tournamentScope.currentLeague();
    if (!league) return interaction.reply({ content: "Elegí la liga del comando en PRUEBAS.", flags: 64 });
    const cfg = readConfig();
    const club = clubs.findClub(interaction.options.getString("club"));
    if (!club) return interaction.reply({ content: "Ese club no figura como habilitado en este servidor. Revisá el nombre o usá /habilitarclub.", flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const lines = [`**${club.name} · ${modality} · ${league.toUpperCase()}**`];
    const roleId = clubs.getRoleForClub(club, modality);
    const role = roleId ? await interaction.guild.roles.fetch(roleId).catch(() => null) : null;
    const registered = (cfg.enabledRoles?.[interaction.guild.id]?.[modality] || []).some((entry) => entry.roleId === roleId);
    lines.push((cfg.enabledModalities || []).includes(modality) ? "Modalidad en servidor: ✅" : "Modalidad en servidor: ❌ no habilitada.");
    lines.push(roleId && role ? `Rol Discord: ✅ <@&${roleId}>${registered ? "" : " (falta en el registro de roles habilitados)"}` : "Rol Discord: ❌ no vinculado o ya no existe; usá /relinkclubes.");
    if (!db.isEnabled) return interaction.editReply({ content: `${lines.join("\n")}\nWeb: ⚠️ este bot no tiene Supabase configurado.` });
    try {
      const modalityRow = await db.getModalidadRow(modality);
      lines.push(modalityRow ? "Modalidad web: ✅" : "Modalidad web: ❌ no registrada.");
      let clubId = await db.getClubIdByName(club.name);
      if (!clubId && interaction.options.getBoolean("reparar") && roleId && role) {
        const created = await db.ensureClubRow(club.name, { abbr: club.abbr, shortName: club.shortName, logoUrl: club.logoUrl, emoji: club.emoji, modalidades: [modality] });
        clubId = created?.id || null;
        lines.push(clubId ? "Ficha web: ✅ creada ahora." : "Ficha web: ❌ no se pudo crear; revisá las migraciones de clubes.");
      } else lines.push(clubId ? "Ficha web: ✅" : "Ficha web: ❌ falta. Repetí con `reparar: Sí` para crearla.");

      if (clubId) {
        const rowResult = await db.request("clubes", { params: { select: "*", id: `eq.${clubId}`, limit: 1 } });
        if (!rowResult.ok) throw new Error(`No pude consultar la ficha web: ${rowResult.error || rowResult.status}`);
        const row = rowResult.data?.[0];
        const logo = row?.logo_url || row?.emoji_url;
        if (row && !Object.hasOwn(row, "logo_url")) lines.push("Escudo web: ⚠️ falta la columna `logo_url`; aplicá su migración en Supabase.");
        else lines.push(logo ? "Escudo web: ✅" : "Escudo web: ❌ falta; cargalo desde Configurar club en la web.");
        if (modalityRow) {
          const state = await db.request("bot_state_documents", { params: { select: "data", name: "eq.config", limit: 1 } });
          if (!state.ok) lines.push("Liga y modalidad en web: ⚠️ no pude consultar la sincronización del bot.");
          else {
            const linkedClubs = state.data?.[0]?.data?.guilds?.[interaction.guild.id]?.clubs || {};
            const linked = Object.entries(linkedClubs).some(([key, value]) =>
              key.toLowerCase() === club.name.toLowerCase() && String(value?.roles?.[modality] || "") === String(roleId || ""));
            lines.push(linked ? "Liga y modalidad sincronizadas: ✅" : "Liga y modalidad sincronizadas: ❌ el bot todavía no subió esta vinculación.");
          }
        }
        const path = leaguePaths[league];
        if (path && modalityRow) lines.push(`Apartado: https://ole-studio-web-1-0-e2.vercel.app/${path}/modalidad/${modalityRow.id}`);
      }
      return interaction.editReply({ content: lines.join("\n").slice(0, 1950) });
    } catch (error) {
      return interaction.editReply({ content: `${lines.join("\n")}\nNo pude terminar la comprobación web: ${error.message}`.slice(0, 1950) });
    }
  }
};
