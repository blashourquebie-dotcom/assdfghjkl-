const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
test('/vinvalidaciones exists, requires admin and saves the destination only for its guild', async () => {
  const config = {}, replies = [];let active;
  const sandbox = { module: { exports: {} }, require(name) {
    if (name === 'discord.js') return require(name);
    if (name === '../utils/database') return {
      withGuild: (g, fn) => { active = g; return fn(); },
      readConfig: () => ({ ...(config[active] || {}) }), saveConfig: value => { config[active] = value; }
    };
    throw Error(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../commands/vinvalidaciones.js'), 'utf8'), sandbox);
  const command = sandbox.module.exports;
  assert.equal(command.data.toJSON().name, 'vinvalidaciones');
  const interaction = (guild, channel, admin) => ({ guild: { id: guild }, channelId: channel,
    channel: { isTextBased: () => true }, member: { permissions: { has: () => admin } }, reply: async value => replies.push(value) });
  await command.execute(interaction('ash', 'ash-reports', true));
  await command.execute(interaction('rtg', 'rtg-reports', true));
  await command.execute(interaction('ash', 'wrong-channel', false));
  assert.equal(config.ash.validationChannelId, 'ash-reports');
  assert.equal(config.rtg.validationChannelId, 'rtg-reports');
  assert(replies[0].content.includes('creación de salas'));
  assert(replies[0].content.includes('sin IP ni conn'));
  assert(replies[2].content.includes('Solo administradores'));
});
