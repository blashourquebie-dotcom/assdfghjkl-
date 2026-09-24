const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scope = require('../utils/tournamentScope');
const command = require('../commands/script');

test('!script ofrece la versión ofuscada de la liga y descarga el archivo desplegable', async () => {
  const replies = [];
  const interaction = {
    guildId: '1293616776747286631', guild: { id: '1293616776747286631' },
    member: { permissions: { has: () => true } },
    reply: async (payload) => { replies.push(payload); return payload; }
  };
  await scope.run(interaction, () => command.execute(interaction));
  assert.equal(replies[0].components.length, 1);
  assert.match(replies[0].embeds[0].data.description, /Versión `0\.1\.1`/);
  await scope.run(interaction, () => command.handleComponent(interaction, ['download', 'ash', 'FUT']));
  const attachment = replies[1].files[0];
  assert.equal(path.basename(attachment.attachment), 'ScriptFUT-ASH.js');
  assert.ok(fs.statSync(attachment.attachment).size > 200_000);
  assert.equal(replies[1].flags, 64);
});
