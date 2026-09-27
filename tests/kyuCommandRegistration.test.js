const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REST } = require('discord.js');
const kyu = require('../utils/kyuApp');
const register = require('../handlers/commandHandler');

test('registers Kyu commands without OAuth and continues after another guild fails', async t => {
  const oldToken = process.env.TOKEN, oldId = process.env.CLIENT_ID;
  process.env.TOKEN = 'test-only';
  process.env.CLIENT_ID = 'test-app';
  t.after(() => {
    if (oldToken === undefined) delete process.env.TOKEN; else process.env.TOKEN = oldToken;
    if (oldId === undefined) delete process.env.CLIENT_ID; else process.env.CLIENT_ID = oldId;
  });
  const integration = kyu.createIntegration({});
  t.mock.method(kyu, 'isGuild', integration.isGuild);
  t.mock.method(kyu, 'commandsFor', integration.commandsFor);
  const calls = [], failures = [];
  t.mock.method(console, 'error', (...args) => failures.push(args.join(' ')));
  t.mock.method(REST.prototype, 'put', async (route, options) => {
    calls.push({ route, commands: options.body });
    if (route.includes('/1400962843674804264/')) throw new Error('mock missing permission');
    return [];
  });
  const guilds = [
    { id: '1400962843674804264', name: 'League failing' },
    { id: '1510011417712132117', name: 'Kyu' },
    { id: '1293616776747286631', name: 'League working' },
    { id: '999999999999999999', name: 'Unrelated' }
  ];
  await register({ guilds: { cache: new Map(guilds.map(g => [g.id, g])) } });
  assert.equal(calls.length, 3, 'unrelated guild is never registered');
  assert.equal(failures.length, 1);
  const names = integration.commandsFor('1510011417712132117').map(c => c.name).sort();
  assert.deepEqual(calls[1].commands.map(c => c.name).sort(), names);
  assert.equal(calls[1].commands.length, 8);
  assert.ok(names.includes('logplanes'));
  for (const call of [calls[0], calls[2]]) {
    assert.ok(call.commands.length > 0, 'league commands are preserved');
    assert.ok(call.commands.every(c => !names.includes(c.name)), 'no Kyu commands leak into league guilds');
  }
  assert.equal(integration.config.enabled, false, 'registration does not turn on app login');
});
