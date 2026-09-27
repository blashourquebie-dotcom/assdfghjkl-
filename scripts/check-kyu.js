const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { configuration } = require('../utils/kyuApp');
const config = configuration();
const required = {
  TOKEN: config.env.DISCORD_BOT_TOKEN,
  CLIENT_ID: config.env.DISCORD_CLIENT_ID,
  KYU_CLIENT_SECRET: config.env.DISCORD_CLIENT_SECRET,
  KYU_GUILD_ID: config.env.DISCORD_GUILD_ID,
  KYU_PUBLIC_URL: config.env.PUBLIC_URL
};
console.log('Chequeo local: no conecta a Discord ni muestra secretos.');
console.log('KYU_ENABLED:', config.enabled ? 'activo' : 'falta establecer 1');
for (const [key, value] of Object.entries(required)) console.log(key + ': ' + (value ? 'definido' : 'FALTA o inválido'));
console.log('KYU_PLAYER_ROLE_ID:', config.env.KYU_PLAYER_ROLE_ID ? 'definido' : 'usar /instalaciónkyu o configurar el ID del rol existente');
console.log('Persistencia: configurar KYU_DATA_FILE en un volumen para conservar roles/planes/amigos al desplegar.');
if (config.env.PUBLIC_URL) {
  console.log('OAuth2 → Redirects: ' + config.env.PUBLIC_URL + '/auth/callback');
  console.log('Comprobar despliegue: ' + config.env.PUBLIC_URL + '/kyu/health');
}
console.log('Interactions Endpoint URL: vacío (este bot usa Gateway).');
process.exitCode = config.enabled && Object.values(required).every(Boolean) ? 0 : 1;
