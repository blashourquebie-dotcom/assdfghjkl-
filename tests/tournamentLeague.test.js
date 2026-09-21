const { test } = require("node:test");
const assert = require("node:assert/strict");
const command = require("../commands/creartorneo");
const wizard = require("../utils/tournamentWizard");
const db = require("../utils/haxoleSupabase");

test("creartorneo ofrece ASH y conserva su liga al guardar", async () => {
  const choices = command.data.toJSON().options.find((o) => o.name === "tipo").choices;
  assert.deepEqual(choices.map((c) => c.value), ["ash", "exclusivo", "tematico"]);
  let preview, posted;
  const originalModality = db.ensureModalidad, originalRequest = db.request;
  db.ensureModalidad = async () => ({ id: "test-mode" });
  db.request = async (table, args) => { posted = { table, ...args }; return { ok: true }; };
  try {
    const interaction = {
      user: { id: "admin" }, guildId: "test-guild",
      member: { permissions: { has: () => true } },
      options: {
        getString: (key) => ({ modalidad: "x4", torneo: "Liga ASH", modo: "liga", tipo: "ASH" })[key],
        getInteger: () => 8
      },
      reply: async (value) => { preview = value; },
      deferUpdate: async () => {},
      editReply: async () => {},
      followUp: async (value) => { throw new Error(value.content); }
    };
    await command.execute(interaction);
    assert.match(preview.embeds[0].data.description, /Liga: ASH/);
    const id = preview.components[0].components[1].data.custom_id.split(":")[2];
    await wizard.handle(interaction, ["save", id]);
    assert.equal(posted.table, "torneos");
    assert.equal(posted.body.tipo, "ash");
  } finally { db.ensureModalidad = originalModality; db.request = originalRequest; }
});
