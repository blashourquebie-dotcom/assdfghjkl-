const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const clubs = require("../utils/clubs");
const nicknames = require("../utils/nicknames");

const unique = (items) => Array.from(new Set(items.filter(Boolean)));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("change")
    .setDescription("Edita el nombre o abreviacion de un club ya creado")
    .addStringOption((o) =>
      o.setName("club")
        .setDescription("Club a editar")
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption((o) =>
      o.setName("nombre")
        .setDescription("Nuevo nombre del club")
        .setRequired(false))
    .addStringOption((o) =>
      o.setName("abreviacion")
        .setDescription("Nueva abreviacion del club")
        .setRequired(false))
    .addBooleanOption((o) =>
      o.setName("actualizar_roles")
        .setDescription("Renombrar los roles del club en Discord (por defecto: si)")
        .setRequired(false))
    .addBooleanOption((o) =>
      o.setName("actualizar_apodos")
        .setDescription("Actualizar apodos de los jugadores del club (por defecto: si)")
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const clubQuery = interaction.options.getString("club");
    const newNameRaw = interaction.options.getString("nombre");
    const newAbbrRaw = interaction.options.getString("abreviacion");
    const shouldUpdateRoles = interaction.options.getBoolean("actualizar_roles") ?? true;
    const shouldUpdateNicknames = interaction.options.getBoolean("actualizar_apodos") ?? true;

    const newName = newNameRaw?.trim();
    const newAbbr = newAbbrRaw?.trim();

    if (!newName && !newAbbr) {
      return interaction.reply({
        content: "Tenes que indicar al menos `nombre` o `abreviacion`.",
        flags: 64
      });
    }

    if (newAbbr && (newAbbr.length < 2 || newAbbr.length > 4)) {
      return interaction.reply({
        content: "La abreviacion tiene que tener entre 2 y 4 caracteres.",
        flags: 64
      });
    }

    const clubEntry = clubs.findClub(clubQuery);
    if (!clubEntry) {
      return interaction.reply({ content: `No encontre el club **${clubQuery}**.`, flags: 64 });
    }

    const finalName = newName || clubEntry.name;
    const finalAbbr = newAbbr || clubEntry.abbr;
    const conflict = clubs.isNameOrAbbrTaken(finalName, finalAbbr, clubEntry.name);
    if (conflict) {
      return interaction.reply({
        content: `El nombre o abreviacion ya esta en uso por **${conflict}**.`,
        flags: 64
      });
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const edited = clubs.editClubIdentity(clubEntry.name, { name: newName, abbr: newAbbr });
      if (!edited) {
        return interaction.editReply({ content: "No pude actualizar el club en la base." });
      }

      const roleIds = unique(Object.values(edited.club.roles || {}));
      const roleResults = [];
      if (shouldUpdateRoles) {
        for (const [modality, roleId] of Object.entries(edited.club.roles || {})) {
          const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
          if (!role) {
            roleResults.push(`${modality}: rol no encontrado`);
            continue;
          }

          const desiredName = `${edited.name} ${modality}`;
          if (role.name === desiredName) {
            roleResults.push(`${modality}: ya estaba bien`);
            continue;
          }

          try {
            await role.setName(desiredName, `Cambio de club por ${interaction.user.tag}`);
            roleResults.push(`${modality}: renombrado`);
          } catch (error) {
            roleResults.push(`${modality}: error ${error.code || error.message}`);
          }
        }
      }

      let nicknamesChecked = 0;
      let nicknamesUpdated = 0;
      if (shouldUpdateNicknames && roleIds.length) {
        await interaction.guild.members.fetch().catch(() => null);
        const memberIds = new Set();

        for (const roleId of roleIds) {
          const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
          for (const member of role?.members?.values?.() || []) {
            memberIds.add(member.id);
          }
        }

        for (const memberId of memberIds) {
          const member = interaction.guild.members.cache.get(memberId) || await interaction.guild.members.fetch(memberId).catch(() => null);
          if (!member) continue;
          const before = member.displayName;
          await nicknames.updateNickname(member);
          await member.fetch(true).catch(() => {});
          nicknamesChecked += 1;
          if (before !== member.displayName) nicknamesUpdated += 1;
        }
      }

      const lines = [
        `Club: **${edited.oldName}** (${edited.oldAbbr || "sin abbr"}) -> **${edited.name}** (${edited.abbr})`,
        `Roles Discord: **${shouldUpdateRoles ? "si" : "no"}**`,
        `Apodos: **${shouldUpdateNicknames ? `${nicknamesUpdated}/${nicknamesChecked} actualizados` : "no"}**`
      ];
      if (roleResults.length) lines.push(`Detalle roles: ${roleResults.join(" | ")}`);

      const embed = new EmbedBuilder()
        .setTitle("Club actualizado")
        .setDescription(lines.join("\n"))
        .setColor(0x2ecc71);

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[change] Error:", error);
      return interaction.editReply({ content: "Ocurrio un error al editar el club.", embeds: [] }).catch(() => {});
    }
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "club") return;
      const options = clubs.searchClubs(focused.value)
        .slice(0, 25)
        .map((club) => ({
          name: `${club.name} (${String(club.abbr || "").toUpperCase()})`.slice(0, 100),
          value: club.name
        }));
      await interaction.respond(options);
    } catch (_) {
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
