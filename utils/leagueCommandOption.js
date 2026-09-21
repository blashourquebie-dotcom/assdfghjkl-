// Add the same explicit league selector to tournament commands and subcommands.
// Real league servers validate it against their fixed guild; PRUEBAS can choose.
function withLeagueOption(command) {
 const options = command.options || [];
 if (options.some(o => o.type === 1 || o.type === 2)) {
  return { ...command, options: options.map(o => o.type === 1 || o.type === 2 ? withLeagueOption(o) : o) };
 }
 if (!options.some(o => o.name === 'torneo') || options.some(o => o.name === 'liga') || options.length >= 25) return command;
 return { ...command, options: [...options, {
  type: 3, name: 'liga', description: 'En PRUEBAS elegí la liga; en los otros servidores se detecta sola.', required: false,
  choices: [{name:'ASH',value:'ash'},{name:'HAXOLE Road to Glory',value:'exclusivo'},{name:'HAXOLE Temático',value:'tematico'}]
 }] };
}
module.exports = { withLeagueOption };
