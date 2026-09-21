const { test } = require("node:test");
const assert = require("node:assert/strict");
const command = require("../commands/creartorneo");
const wizard = require("../utils/tournamentWizard");
test("creation infers official guild, rejects a conflicting league, requires explicit type in tests", async () => {
 const original = wizard.begin;
 let draft, message;
 wizard.begin = async (_, value) => { draft = value; };
 async function run(guildId, tipo) {
  draft = null; message = null;
  await command.execute({ guildId, member: { permissions: { has: () => true } }, options: { getString: key => ({ modalidad: "x3", torneo: "LIGA T1", tipo })[key], getInteger: () => 4 }, reply: async value => { message = value.content; } });
 }
 try {
  for (const [guild, tipo] of [["1293616776747286631", "ash"], ["1400962843674804264", "exclusivo"], ["1513342723594129458", "tematico"]]) {
   await run(guild); assert.equal(draft.tipo, tipo);
  }
  await run("1293616776747286631", "exclusivo"); assert.equal(draft, null); assert.match(message, /otra liga/);
  await run("1477848311019864106"); assert.equal(draft, null); assert.match(message, /Indicá tipo/);
  await run("1477848311019864106", "ash"); assert.equal(draft.tipo, "ash");
 } finally { wizard.begin = original; }
});
