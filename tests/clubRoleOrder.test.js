const test = require('node:test');
const assert = require('node:assert/strict');
const { maybePlaceBelow } = require('../utils/serverSetup');

test('habilitar un club ubica su rol justo debajo del jugador de la modalidad', async () => {
  const positions = [];
  const guild = { members: { me: { permissions: { has: () => true } } } };
  const anchor = { position: 7 };
  const role = { position: 2, setPosition: async position => { positions.push(position); role.position = position; } };
  assert.equal(await maybePlaceBelow(guild, role, anchor), true);
  assert.deepEqual(positions, [6]);
  assert.equal(await maybePlaceBelow(guild, role, anchor), false);
  assert.deepEqual(positions, [6]);
});
