const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig, saveConfig, upsertUserClubAffiliation, addHistory } = require("../utils/database");
const clubs = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { updateLinkedForumTemplates } = require("../utils/plantillas");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cap")
    .setDescription("Marca capitanes por club y modalidad")
    .addStringOption((opt) => opt.setName("club").setDescription("Nombre del club").setRequired(true).setAutocomplete(true))
    .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario a asignar").setRequired(true))
    .addStringOption((opt) => opt.setName("modalidades").setDescription("Opcional. Modalidades separadas por coma; vacio = todas").setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const clubQ = interaction.options.getString("club");
    const modalidadesRaw = interaction.options.getString("modalidades");
    const user = interaction.options.getUser("usuario");
    if (!user) {
      return interaction.reply({ content: "Menciona el usuario que queres marcar como CAP.", flags: 64 });
    }

    console.log(`[cap] Asignando capitan ${user.tag} a club ${clubQ} en modalidades: ${modalidadesRaw || "todas"}`);

    const cfg = readConfig();
    const clubEntry = clubs.findClub(clubQ);
    if (!clubEntry) {
      return interaction.reply({ content: `Club **${clubQ}** no encontrado`, flags: 64 });
    }

    try {
      const parsed = modalidadesRaw
        ? roleRegistry.parseModalitiesInput(modalidadesRaw)
        : { modalities: Object.keys(clubEntry.roles || {}).map(roleRegistry.normalizeModality).filter(Boolean), invalid: [] };
      const modalidades = parsed.modalities;

      if (parsed.invalid.length || !modalidades.length) {
        return interaction.reply({ content: "Debes indicar al menos una modalidad valida.", flags: 64 });
      }

      const disabled = modalidades.filter((mod) => !roleRegistry.isEnabledModality(cfg, mod));
      if (disabled.length) {
        return interaction.reply({ content: `Estas modalidades no estan habilitadas globalmente: ${disabled.join(", ")}`, flags: 64 });
      }

      const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
      if (!botMember) {
        return interaction.reply({ content: "No pude verificar los permisos del bot en este servidor.", flags: 64 });
      }

      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: "El bot necesita el permiso **Administrar roles** para asignar capitanias.", flags: 64 });
      }

      const member = await interaction.guild.members.fetch(user.id);
      const captainRoleIds = [];
      const previousCaptains = {};
      const blockedRoles = [];

      for (const mod of modalidades) {
        const clubRoleId = clubs.getRoleForClub(clubEntry, mod);
        const clubRole = clubRoleId ? interaction.guild.roles.cache.get(clubRoleId) : null;
        if (!clubRoleId || !member.roles.cache.has(clubRoleId)) {
          return interaction.reply({
            content: `El usuario no tiene rol en ${clubEntry.name} para ${mod}`,
            flags: 64
          });
        }

        const captainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "captain");
        if (!captainRole?.roleId) {
          return interaction.reply({
            content: `No hay un rol general de capitán configurado para ${mod}.`,
            flags: 64
          });
        }

        const captainRoleObj = interaction.guild.roles.cache.get(captainRole.roleId);
        if (!clubRole) {
          return interaction.reply({
            content: `No pude encontrar el rol del club **${clubEntry.name}** para **${mod}** en Discord.`,
            flags: 64
          });
        }
        if (!captainRoleObj) {
          return interaction.reply({
            content: `No pude encontrar el rol de capitán para **${mod}** en Discord.`,
            flags: 64
          });
        }

        if (clubRole.position >= botMember.roles.highest.position) {
          blockedRoles.push(`club ${clubEntry.name} ${mod}`);
        }
        if (captainRoleObj.position >= botMember.roles.highest.position) {
          blockedRoles.push(`CAP ${mod}`);
        }

        previousCaptains[mod] = cfg.clubs?.[clubEntry.name]?.captains?.[mod] || null;
        captainRoleIds.push(captainRole.roleId);
      }

      if (blockedRoles.length) {
        return interaction.reply({
          content: `No puedo asignar estos roles porque estan por encima del bot o al mismo nivel: ${Array.from(new Set(blockedRoles)).join(", ")}. Mueve el rol del bot mas arriba en la jerarquia o baja esos roles.`,
          flags: 64
        });
      }

      if (captainRoleIds.length) {
        await member.roles.add(captainRoleIds, `Capitan asignado de ${clubEntry.name} por /cap`).catch((error) => {
          if (error?.code === 50013) {
            throw new Error("Missing Permissions al asignar roles. Revisar jerarquia de roles del bot.");
          }
          throw error;
        });
      }

      if (!cfg.clubs[clubEntry.name].captains) cfg.clubs[clubEntry.name].captains = {};
      for (const mod of modalidades) {
        if (String(cfg.clubs[clubEntry.name].subcaptains?.general || "") === String(user.id)) {
          delete cfg.clubs[clubEntry.name].subcaptains.general;
        }
        if (String(cfg.clubs[clubEntry.name].subcaptains?.[mod] || "") === String(user.id)) {
          delete cfg.clubs[clubEntry.name].subcaptains[mod];
        }
        cfg.clubs[clubEntry.name].captains[mod] = user.id;
        const roleId = clubs.getRoleForClub(clubEntry, mod);
        upsertUserClubAffiliation(user.id, {
          club: clubEntry.name,
          abbr: clubEntry.abbr,
          modality: mod,
          roleId,
          by: interaction.user.tag
        });
        addHistory(user.id, "CAP", { modality: mod, club: clubEntry.name, by: interaction.user.tag });
      }
      saveConfig(cfg);

      for (const mod of modalidades) {
        const subcaptainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "subcaptain");
        if (subcaptainRole?.roleId && member.roles.cache.has(subcaptainRole.roleId)) {
          await member.roles.remove(subcaptainRole.roleId, `CAP asignado en ${clubEntry.name} ${mod}`).catch(() => null);
        }
      }

      for (const mod of modalidades) {
        const previousCapId = previousCaptains[mod];
        if (!previousCapId || String(previousCapId) === String(user.id)) continue;

        const captainRole = roleRegistry.getGeneralRole(cfg, interaction.guild.id, mod, "captain");
        if (!captainRole?.roleId) continue;

        const stillCaptainElsewhere = Object.entries(cfg.clubs || {}).some(([otherClub, otherEntry]) => {
          if (otherClub === clubEntry.name) return false;
          return String(otherEntry?.captains?.[mod] || "") === String(previousCapId);
        });
        if (stillCaptainElsewhere) continue;

        const oldCapMember = await interaction.guild.members.fetch(previousCapId).catch(() => null);
        if (oldCapMember?.roles?.cache?.has(captainRole.roleId)) {
          await oldCapMember.roles.remove(captainRole.roleId, `CAP reemplazado en ${clubEntry.name} ${mod}`).catch(() => null);
        }
      }

      for (const mod of modalidades) {
        await updateLinkedForumTemplates(interaction.guild, clubEntry.name, mod).catch(() => null);
      }

      return interaction.reply({
        content: `**${user.tag}** marcado como capitán de **${clubEntry.name}** en: ${modalidades.join(", ")}`,
        flags: 64
      });
    } catch (error) {
      console.error("[cap] Error:", error);
      return interaction.reply({ content: "Error al asignar capitán.", flags: 64 });
    }
  },

  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "club") {
      const cfg = readConfig();
      const clubNames = Object.keys(cfg.clubs || {});
      const filtered = clubNames.filter((c) => c.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      await interaction.respond(filtered.map((c) => ({ name: c, value: c })));
    }
  }
};
