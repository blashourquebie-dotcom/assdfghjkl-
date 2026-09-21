const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetnicks')
    .setDescription('Resetea todos los apodos del servidor (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  async execute(interaction) {
    // Permiso extra por si se usa por prefijo
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({ content: '❌ Solo administradores con permiso de cambiar apodos pueden usar este comando.', flags: 64 });
    }
    try {
      console.log('[resetnicks] Iniciando reseteo de apodos...');
      await interaction.reply({ content: '⏳ Reseteando apodos, esto puede tardar unos segundos...', flags: 64 });
      // Asegura que todos los miembros estén en caché
      const members = await interaction.guild.members.fetch();
      console.log(`[resetnicks] Encontrados ${members.size} miembros, procesando...`);
      const promises = [];
      let count = 0;
      for (const member of members.values()) {
        // Solo procesar miembros que NO sean bots y que tengan apodo
        if (!member.user.bot && member.manageable && member.nickname) {
          const oldNick = member.nickname;
          promises.push(
            member.setNickname(null, 'Reset global de apodos')
              .then(() => {
                count++;
                console.log(`[resetnicks] ✅ @${member.user.tag} - Apodo removido: "${oldNick}"`);
              })
              .catch((err) => {
                console.log(`[resetnicks] ❌ @${member.user.tag} - No se pudo remover apodo: "${oldNick}" (${err.message})`);
              })
          );
        }
      }
      await Promise.all(promises);
      console.log(`[resetnicks] ✅ Completado - ${count} apodos reseteados`);
      return interaction.editReply({ content: `✅ Apodos reseteados para ${count} miembros.` });
    } catch (error) {
      console.error('Error en resetnicks:', error);
      return interaction.reply({ content: '❌ Error al resetear apodos.', flags: 64 });
    }
  }
};
