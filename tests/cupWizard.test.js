const { test } = require("node:test");
const assert = require("node:assert/strict");
const wizard = require("../utils/tournamentWizard");
const db = require("../utils/haxoleSupabase");

test("Copa no muestra ni guarda clasificación y etiquetas", async () => {
  let preview, saved, modal;
  const originalModality = db.ensureModalidad, originalRequest = db.request;
  db.ensureModalidad = async () => ({ id: "mode" });
  db.request = async (_, payload) => { saved = payload.body; return { ok: true }; };
  const interaction = {
    user: { id: "admin" }, guildId: "guild",
    member: { permissions: { has: () => true } },
    reply: async (p) => { preview = p; },
    showModal: async (p) => { modal = p.toJSON(); },
    awaitModalSubmit: async () => { throw new Error("Timeout simulado"); },
    deferUpdate: async () => {}, editReply: async () => {},
    followUp: async (p) => { throw new Error(p.content); }
  };
  try {
    await wizard.begin(interaction, { name: "Copa", count: 8, modality: "x4", tipo: "ash", formato: "copa" });
    assert.doesNotMatch(preview.embeds[0].data.description, /Clasifican|Etiquetas/);
    const id = preview.components[0].components[0].data.custom_id.split(":")[2];
    await wizard.handle(interaction, ["advanced", id]);
    assert.equal(modal.components.length, 2);
    assert.equal(modal.components[0].components[0].custom_id, "legs");
    assert.equal(modal.components[1].components[0].custom_id, "count");
    await wizard.handle(interaction, ["save", id]);
    assert.deepEqual(saved.configuracion, { ida_vuelta: false });
  } finally { db.ensureModalidad = originalModality; db.request = originalRequest; }
});
