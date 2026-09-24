const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const scope = require('../utils/tournamentScope');

const releaseDirectory = path.resolve(__dirname, '..', 'assets', 'releases');
const leagueNames = { ash: 'ASH', exclusivo: 'HAXOLE #ROADTOGLORY', tematico: 'HAXOLE #TEMÁTICO' };
const releaseNames = { ash: 'ASH', exclusivo: 'Oficiales', tematico: 'Tematico' };

function releaseFile(league, mode) {
  const suffix = releaseNames[league];
  if (!suffix || !['FUT', 'RS'].includes(mode)) return null;
  const file = path.join(releaseDirectory, `Script${mode}-${suffix}.js`);
  return fs.existsSync(file) ? file : null;
}

function downloadButtons(league) {
  const leagues = league ? [league] : ['ash', 'exclusivo', 'tematico'];
  return leagues.map((key) => new ActionRowBuilder().addComponents(
    ...['FUT', 'RS'].map((mode) => new ButtonBuilder()
      .setCustomId(`script:download:${key}:${mode}`)
      .setLabel(`Descargar ${mode === 'FUT' ? 'Futsal' : 'Real Soccer'} · ${leagueNames[key]}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!releaseFile(key, mode)))
  ));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('script')
    .setDescription('Descargá el script oficial ofuscado para hostear')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo administradores pueden descargar el script.', flags: 64 });
    }
    const league = scope.currentLeague();
    const embed = new EmbedBuilder()
      .setColor(0x12151d)
      .setTitle('📦 Instalar HaxOle Host')
      .setDescription([
        'Script oficial para crear salas y jugar partidos de HaxOle.',
        '',
        '**Versión `0.1.1` · edición ofuscada**',
        'Elegí Futsal o Real Soccer y descargá el archivo de tu liga con el botón de abajo.'
      ].join('\n'))
      .addFields(
        { name: '🆕 Incluye', value: '• Validación de jugadores por Discord\n• Partidos oficiales conectados a la web\n• Grabación y subida de replays' },
        { name: '🎬 Tutorial', value: 'La guía para iniciar sesión y crear la sala se agregará próximamente.' }
      )
      .setFooter({ text: 'HaxOle · Usá la versión vigente del script' });
    return interaction.reply({ embeds: [embed], components: downloadButtons(league) });
  },

  async handleComponent(interaction, [action, league, mode]) {
    if (action !== 'download') return interaction.reply({ content: 'Acción desconocida.', flags: 64 });
    if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo administradores pueden descargar el script.', flags: 64 });
    }
    const guildLeague = scope.currentLeague();
    if (guildLeague && guildLeague !== league) return interaction.reply({ content: 'Este script no corresponde a tu liga.', flags: 64 });
    const file = releaseFile(league, mode);
    if (!file) return interaction.reply({ content: 'No encontré esa versión ofuscada en el servidor.', flags: 64 });
    return interaction.reply({ content: `**${leagueNames[league]} · ${mode === 'FUT' ? 'Futsal' : 'Real Soccer'} · v0.1.1**\nPegá el contenido completo en la consola de HaxBall Headless.`, files: [new AttachmentBuilder(file, { name: path.basename(file) })], flags: 64 });
  }
};
