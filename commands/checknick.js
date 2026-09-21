const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const nicknames = require('../utils/nicknames');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('checknick')
    .setDescription('Muestra el apodo que se aplicaría a un usuario (debug)')
    .addUserOption(o => o.setName('usuario').setDescription('Usuario a comprobar').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Solo administradores pueden usar este comando.', flags: 64 });
    }

    const target = interaction.options.getUser('usuario');
    if (!target) return interaction.reply({ content: '❌ Usuario inválido.', flags: 64 });

    try {
      const member = await interaction.guild.members.fetch(target.id);
      const res = await nicknames.computeNickname(member);
      // permission and hierarchy checks
      const me = member.guild.members.me;
      const botCanManage = me?.permissions?.has?.(1 << 26) || me?.permissions?.has?.('ManageNicknames');
      const botHighest = me?.roles?.highest?.position || 0;
      const memberHighest = member.roles.highest?.position || 0;
      const isOwner = member.id === member.guild.ownerId;

      const embed = new EmbedBuilder()
        .setTitle('Check Nickname')
        .addFields(
          { name: 'Usuario', value: `${member.user.tag} (${member.id})` },
          { name: 'Apodo calculado', value: res.newNick || '(no calculado)' },
          { name: 'Prefijos', value: res.prefixParts && res.prefixParts.length ? res.prefixParts.join(' ') : '(ninguno)' },
          { name: 'Bot puede ManageNicknames', value: botCanManage ? 'Sí' : 'No', inline: true },
          { name: 'Rol bot (posición)', value: `${botHighest}`, inline: true },
          { name: 'Rol usuario (posición)', value: `${memberHighest}`, inline: true },
          { name: 'Es owner del servidor', value: isOwner ? 'Sí' : 'No', inline: true }
        )
        .setColor(0x3498db);

      return interaction.reply({ embeds: [embed], flags: 64 });
    } catch (err) {
      console.error('checknick error', err);
      return interaction.reply({ content: '❌ Error al calcular apodo. Revisa la consola.', flags: 64 });
    }
  }
};
