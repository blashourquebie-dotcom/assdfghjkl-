const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { readConfig, saveConfig } = require('../utils/database');
const roleRegistry = require('../utils/roleRegistry');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('futsal')
    .setDescription('Crea o verifica los roles generales de FUTSAL.')
    .addStringOption((option) =>
      option.setName('confirm')
        .setDescription('Escribe "CONFIRMAR" para proceder')
        .setRequired(true)),

  async execute(interaction) {
    let canRespond = true;

    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo administradores pueden usar este comando.', flags: 64 });
    }

    const confirm = interaction.options.getString('confirm');
    if (confirm !== 'CONFIRMAR') {
      return interaction.reply({ content: 'Debes escribir "CONFIRMAR" para proceder.', flags: 64 });
    }

    const modalidades = ['x3', 'x4', 'x5', 'x7'];

    try {
      await interaction.deferReply({ flags: 64 });
      const cfg = readConfig();
      const guild = interaction.guild;
      const gid = guild.id;
      const botMember = guild.members.me;

      if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply({ content: 'El bot no tiene permisos para gestionar roles.' });
      }

      console.log(`[futsal] Verificando roles generales en guild ${gid}`);

      const rolesBorrados = [];
      const rolesCreados = [];
      const rolesVinculados = [];

      for (const mod of modalidades) {
        const canonical = {
          player: `jugador${mod}`,
          captain: `cap${mod}`
        };

        const legacyRoleNames = [
          `jugadorfutx${mod.replace('x', '')}`,
          `capfutx${mod.replace('x', '')}`,
          `jugadorfut${mod}`,
          `capfut${mod}`
        ];

        let playerRole = guild.roles.cache.find((r) => r.name === canonical.player);
        if (!playerRole) {
          playerRole = await guild.roles.create({
            name: canonical.player,
            colors: { primaryColor: 0x99AAB5 },
            reason: `Rol general FUTSAL creado por /futsal para ${mod}`
          });
          rolesCreados.push(canonical.player);
          console.log(`[futsal] Creado rol general: ${canonical.player}`);
        }

        let captainRole = guild.roles.cache.find((r) => r.name === canonical.captain);
        if (!captainRole) {
          captainRole = await guild.roles.create({
            name: canonical.captain,
            colors: { primaryColor: 0xF1C40F },
            reason: `Rol general FUTSAL creado por /futsal para ${mod}`
          });
          rolesCreados.push(canonical.captain);
          console.log(`[futsal] Creado rol general: ${canonical.captain}`);
        }

        roleRegistry.setGeneralRole(cfg, gid, mod, 'player', {
          roleId: playerRole.id,
          name: playerRole.name
        });
        roleRegistry.setGeneralRole(cfg, gid, mod, 'captain', {
          roleId: captainRole.id,
          name: captainRole.name
        });
        rolesVinculados.push(`${mod}: ${playerRole.name} / ${captainRole.name}`);

        for (const roleName of legacyRoleNames) {
          const legacyRole = guild.roles.cache.find((r) => r.name === roleName);
          if (!legacyRole) continue;

          await legacyRole.delete('Borrado por /futsal para limpiar aliases viejos');
          rolesBorrados.push(roleName);
          console.log(`[futsal] Borrado rol legacy: ${roleName}`);
        }
      }

      cfg.enabledModalities = Array.from(
        new Set([...(cfg.enabledModalities || []), ...modalidades].map((mod) => roleRegistry.normalizeModality(mod)).filter(Boolean))
      );
      saveConfig(cfg);

      const embed = new EmbedBuilder()
        .setTitle('Roles Generales FUTSAL')
        .setDescription(`Se verificaron y vincularon los roles de jugador/capitan para: ${modalidades.join(', ')}`)
        .addFields(
          { name: 'Roles Borrados', value: rolesBorrados.length > 0 ? rolesBorrados.join('\n') : 'Ninguno', inline: true },
          { name: 'Roles Creados', value: rolesCreados.length > 0 ? rolesCreados.join('\n') : 'Ninguno', inline: true },
          { name: 'Roles Vinculados', value: rolesVinculados.join('\n'), inline: false }
        );

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[futsal] Error:', error);
      if (error?.code === 10062) {
        canRespond = false;
      }
      if (!canRespond) return;
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: 'Error al crear o verificar roles generales.' }).catch(() => {});
      }
      return interaction.reply({ content: 'Error al crear o verificar roles generales.', flags: 64 }).catch(() => {});
    }
  }
};
