const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const leagues = {
  '1400962843674804264': 'exclusivo',
  '1513342723594129458': 'tematico',
  '1293616776747286631': 'ash'
};
const TEST_GUILD = '1477848311019864106';
function currentGuild() { return context.getStore()?.guild || require('./database').getActiveGuildId(); }
function allowedGuild(guild) { return guild === TEST_GUILD || Object.hasOwn(leagues, String(guild)); }
function currentLeague() {
  const guild = currentGuild();
  return leagues[guild] || (guild === TEST_GUILD ? context.getStore()?.league || null : null);
}
function leagueForGuild(guild) { return leagues[guild] || null; }
function run(interaction, task) {
  const guild = interaction.guildId || interaction.guild?.id;
  const explicit = interaction.options?.getString?.('liga');
  if (explicit && !['ash', 'exclusivo', 'tematico'].includes(explicit)) throw new Error('Liga inválida.');
  if (explicit && leagues[guild] && explicit !== leagues[guild]) {
    throw Object.assign(new Error('Desde este servidor solo podés operar en ' + leagues[guild] + '.'), { code: 'LEAGUE_SCOPE_DENIED' });
  }
  const testLeague = explicit || process.env.HAXOLE_TEST_LEAGUE;
  const league = leagues[guild] || (guild === '1477848311019864106' && ['ash', 'exclusivo', 'tematico'].includes(testLeague) ? testLeague : null);
  if (!allowedGuild(guild)) throw new Error('Este bot no está habilitado en este servidor.');
  return context.run({ guild, league }, task);
}
function unambiguous(rows) {
  const names = new Set();
  for (const row of rows) {
    const key = row.modalidad_id + ':' + String(row.nombre).trim().toLowerCase();
    if (names.has(key)) throw new Error('Hay torneos con el mismo nombre en distintas ligas. En PRUEBAS elegí la opción liga: ash, exclusivo o tematico.');
    names.add(key);
  }
  return rows;
}
module.exports = { run, currentLeague, currentGuild, allowedGuild, TEST_GUILD, unambiguous, leagueForGuild };
