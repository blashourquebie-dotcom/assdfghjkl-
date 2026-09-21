const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { readConfig } = require('../utils/database');
const nicknames = require('../utils/nicknames');
const roleRegistry = require('../utils/roleRegistry');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refreshnicknames')
    .setDescription('Verifica y corrige apodos: actualiza nombre base y pone #ABBR en MAYÚSCULAS (rápido).')
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a procesar (opcional)'))
    .addStringOption(opt => opt.setName('usuarios').setDescription('Usuarios (menciones o IDs separadas por coma) (opcional)'))
    .addIntegerOption(opt => opt.setName('limit').setDescription('Máximo de miembros a procesar cuando no se especifica usuario (por defecto 50)').setMinValue(1).setMaxValue(200)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Solo administradores pueden usar este comando.', flags: 64 });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const targetUser = interaction.options.getUser('usuario');
      const usuariosList = interaction.options.getString('usuarios');
      const limitOpt = interaction.options.getInteger('limit') || 50;
      const cfg = readConfig();
      const members = [];

      if (usuariosList) {
        const ids = usuariosList.split(',').map(s => s.trim()).map(s => {
          const m = s.match(/<@!?(\d+)>/);
          return m ? m[1] : (s.match(/^\d+$/) ? s : null);
        }).filter(Boolean);
        for (const id of ids) {
          try { members.push(await interaction.guild.members.fetch(id)); } catch {};
        }
      }

      if (targetUser) {
        try { members.push(await interaction.guild.members.fetch(targetUser.id)); } catch {};
      }

      // If no explicit users, scan cached members who have any enabled club role for this guild
      if (members.length === 0) {
        const roleIds = roleRegistry.getAllClubRoleIdsForGuild(cfg, interaction.guild.id);

        const seen = new Set();
        for (const m of interaction.guild.members.cache.values()) {
          if (members.length >= limitOpt) break;
          for (const r of roleIds) {
            if (m.roles.cache.has(r)) {
              if (!seen.has(m.id)) { members.push(m); seen.add(m.id); }
              break;
            }
          }
        }
      }

      if (members.length === 0) {
        await interaction.editReply({ content: '⚠️ No se encontraron usuarios para procesar. Especifica `usuario`/`usuarios` o asegúrate de que el bot tenga miembros en caché con roles de club.' });
        return;
      }

      const results = { checked: 0, fixed: 0, failed: 0 };
      const lines = [];

      for (const member of members) {
        results.checked++;
        try {
          const res = await nicknames.computeNickname(member);
          const prefixParts = res && res.prefixParts ? res.prefixParts : [];
          if (!prefixParts || prefixParts.length === 0) {
            // no tiene roles de club relevantes
            lines.push(`— ${member.user.tag}: sin prefijos de club, omitido`);
            continue;
          }

          const base = nicknames.stripNickTags(member.user.username || member.user.username);
          let desired = `${prefixParts.join(' ')} ${base}`.trim();
          if (desired.length > 32) desired = desired.slice(0, 32);

          if (member.displayName === desired) {
            lines.push(`✅ ${member.user.tag}: OK`);
            continue;
          }

          try {
            await member.setNickname(desired, 'RefreshNicknames: sincronizar nombre base y mayúsculas de abreviaciones');
            lines.push(`🔧 ${member.user.tag}: actualizado → "${desired}"`);
            results.fixed++;
          } catch (err) {
            lines.push(`❌ ${member.user.tag}: fallo al cambiar apodo (${err?.code || err?.message || 'error'})`);
            results.failed++;
          }
        } catch (err) {
          console.error('refreshnicknames: error procesando miembro', member.id, err);
          lines.push(`❌ ${member.user.tag}: error interno`);
          results.failed++;
        }
      }

      const out = [`Comprobados: ${results.checked}`, `Actualizados: ${results.fixed}`, `Fallaron: ${results.failed}`, 'Detalles:', ...lines].join('\n');
      await interaction.editReply({ content: out });

    } catch (err) {
      console.error('Error en /refreshnicknames', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Error al ejecutar el comando. Revisa la consola.' }).catch(() => {});
      } else {
        await interaction.reply({ content: '❌ Error al ejecutar el comando. Revisa la consola.', flags: 64 }).catch(() => {});
      }
    }
  }
};
