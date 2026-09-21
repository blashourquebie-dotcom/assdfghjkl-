const { SlashCommandBuilder } = require("discord.js");
const { readConfig, saveConfig, readUsers, saveUsers } = require("../utils/database");
const roleRegistry = require("../utils/roleRegistry");

const EPHEMERAL = 64;

const parseModalities = (raw) => {
  if (!raw) return { modalities: [], invalid: [] };
  if (/^(todo|todos|toda|todas|all)$/i.test(String(raw).trim())) return { modalities: [], invalid: [] };
  return roleRegistry.parseModalitiesInput(String(raw).replace(/\s+/g, ","));
};

const getKnownModalities = (cfg, guildId, users) => {
  const out = new Set();
  const add = (value) => {
    const mod = roleRegistry.normalizeModality(value);
    if (mod) out.add(mod);
  };

  for (const mod of cfg.enabledModalities || []) add(mod);
  for (const mod of Object.keys(cfg.enabledRoles?.[guildId] || {})) add(mod);
  for (const mod of Object.keys(cfg.generalRoles?.[guildId] || {})) add(mod);

  for (const club of Object.values(cfg.clubs || {})) {
    for (const mod of Object.keys(club?.roles || {})) add(mod);
    for (const mod of Object.keys(club?.captains || {})) add(mod);
    for (const mod of Object.keys(club?.subcaptains || {})) add(mod);
  }

  for (const user of Object.values(users || {})) {
    for (const mod of Object.keys(user?.clubRoles || {})) add(mod);
    for (const affiliation of Object.values(user?.clubAffiliations || {})) {
      for (const mod of Object.keys(affiliation?.modalities || {})) add(mod);
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
};

const getRoleIdsToRemove = (cfg, guildId, modalities) => {
  const roleIds = new Set();

  for (const modality of modalities) {
    for (const entry of roleRegistry.getClubRoles(cfg, guildId, modality)) {
      if (entry?.roleId) roleIds.add(entry.roleId);
    }

    const general = roleRegistry.getGeneralRoles(cfg, guildId, modality);
    if (general.playerRoleId) roleIds.add(general.playerRoleId);
    if (general.captainRoleId) roleIds.add(general.captainRoleId);
    if (general.subcaptainRoleId) roleIds.add(general.subcaptainRoleId);
  }

  return Array.from(roleIds);
};

const clearConfigAssignments = (cfg, modalities, resetAllModalities) => {
  let captains = 0;
  let subcaptains = 0;

  for (const club of Object.values(cfg.clubs || {})) {
    if (club?.captains) {
      for (const mod of modalities) {
        if (club.captains[mod]) {
          delete club.captains[mod];
          captains++;
        }
      }
    }

    if (club?.subcaptains) {
      if (resetAllModalities && club.subcaptains.general) {
        delete club.subcaptains.general;
        subcaptains++;
      }

      for (const mod of modalities) {
        if (club.subcaptains[mod]) {
          delete club.subcaptains[mod];
          subcaptains++;
        }
      }
    }
  }

  return { captains, subcaptains };
};

const clearUserLinks = (users, modalities) => {
  let usersTouched = 0;
  let links = 0;
  const modalitySet = new Set(modalities);

  for (const user of Object.values(users || {})) {
    if (!user || typeof user !== "object") continue;
    let touched = false;

    user.clubRoles = user.clubRoles && typeof user.clubRoles === "object" ? user.clubRoles : {};
    user.clubAffiliations = user.clubAffiliations && typeof user.clubAffiliations === "object" ? user.clubAffiliations : {};

    for (const mod of modalities) {
      if (user.clubRoles[mod]) {
        delete user.clubRoles[mod];
        links++;
        touched = true;
      }
    }

    for (const [clubName, affiliation] of Object.entries(user.clubAffiliations)) {
      const clubModalities = affiliation?.modalities;
      if (!clubModalities || typeof clubModalities !== "object") continue;

      for (const mod of Object.keys(clubModalities)) {
        if (!modalitySet.has(roleRegistry.normalizeModality(mod))) continue;
        delete clubModalities[mod];
        links++;
        touched = true;
      }

      if (!Object.keys(clubModalities).length) delete user.clubAffiliations[clubName];
    }

    if (touched) usersTouched++;
  }

  return { usersTouched, links };
};

const resetNicknames = async (guild) => {
  const members = await guild.members.fetch();
  let reset = 0;
  let failed = 0;

  for (const member of members.values()) {
    if (member.user.bot || !member.nickname || !member.manageable) continue;
    try {
      await member.setNickname(null, "Reset global por /resetear");
      reset++;
    } catch (error) {
      failed++;
      console.log(`[resetear] No se pudo resetear apodo de ${member.user.tag}: ${error.message}`);
    }
  }

  return { reset, failed };
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resetear")
    .setDescription("Resetea vinculaciones, roles de liga y apodos del servidor (solo owner)")
    .addStringOption((opt) =>
      opt
        .setName("modalidades")
        .setDescription("Opcional. Modalidades separadas por coma o espacios; vacio = todas")
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: "Este comando solo se puede usar en un servidor.", flags: EPHEMERAL });
    }

    if (String(interaction.user.id) !== String(guild.ownerId)) {
      return interaction.reply({ content: "Solo el owner del servidor puede usar este comando.", flags: EPHEMERAL });
    }

    const rawModalities = interaction.options.getString("modalidades");
    const cfg = readConfig();
    const users = readUsers();
    const knownModalities = getKnownModalities(cfg, guild.id, users);
    const parsed = parseModalities(rawModalities);
    const resetAllRequested = !rawModalities || /^(todo|todos|toda|todas|all)$/i.test(String(rawModalities).trim());
    const modalities = resetAllRequested ? knownModalities : parsed.modalities;

    if (parsed.invalid.length) {
      return interaction.reply({
        content: `Modalidades invalidas: ${parsed.invalid.join(", ")}. Ejemplo: \`x3, x4\`.`,
        flags: EPHEMERAL
      });
    }

    if (!modalities.length) {
      return interaction.reply({ content: "No encontre modalidades para resetear.", flags: EPHEMERAL });
    }

    const unknown = modalities.filter((mod) => !knownModalities.includes(mod));
    if (unknown.length) {
      return interaction.reply({
        content: `No encontre estas modalidades configuradas: ${unknown.join(", ")}.`,
        flags: EPHEMERAL
      });
    }

    await interaction.reply({
      content: `Iniciando reset de **${modalities.join(", ")}**. Esto puede tardar unos segundos...`,
      flags: EPHEMERAL
    });

    try {
      const roleIds = getRoleIdsToRemove(cfg, guild.id, modalities);
      const resetAllModalities = knownModalities.every((mod) => modalities.includes(mod));
      const members = await guild.members.fetch();
      let membersWithRoles = 0;
      let rolesRemoved = 0;
      let roleFailures = 0;

      for (const member of members.values()) {
        const removable = roleIds.filter((roleId) => member.roles.cache.has(roleId));
        if (!removable.length) continue;
        try {
          await member.roles.remove(removable, `Reset de modalidades ${modalities.join(", ")} por /resetear`);
          membersWithRoles++;
          rolesRemoved += removable.length;
        } catch (error) {
          roleFailures++;
          console.log(`[resetear] No se pudieron quitar roles a ${member.user.tag}: ${error.message}`);
        }
      }

      const configStats = clearConfigAssignments(cfg, modalities, resetAllModalities);
      const userStats = clearUserLinks(users, modalities);
      saveConfig(cfg);
      saveUsers(users);

      const nicknameStats = await resetNicknames(guild);

      return interaction.editReply({
        content: [
          `Reset completado para: **${modalities.join(", ")}**`,
          `Vinculaciones limpiadas: ${userStats.links} en ${userStats.usersTouched} usuario(s).`,
          `Asignaciones CAP/SC limpiadas: ${configStats.captains + configStats.subcaptains}.`,
          `Roles quitados: ${rolesRemoved} en ${membersWithRoles} miembro(s).`,
          `Apodos reseteados: ${nicknameStats.reset}.`,
          roleFailures || nicknameStats.failed
            ? `No se pudieron completar algunas acciones por permisos/jerarquia: roles ${roleFailures}, apodos ${nicknameStats.failed}.`
            : "Sin errores de permisos detectados."
        ].join("\n")
      });
    } catch (error) {
      console.error("[resetear] Error:", error);
      return interaction.editReply({ content: "Error al ejecutar el reset." });
    }
  }
};
