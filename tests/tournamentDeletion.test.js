const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../utils/haxoleSupabase");
const command = require("../commands/borrartorneo");
const oldCommand = require("../commands/eliminartorneo");

const makeInteraction = () => {
  const replies = [];
  return {
    guildId: "1293616776747286631",
    guild: { id: "1293616776747286631" },
    user: { id: "admin" },
    member: { permissions: { has: () => true } },
    options: { getString: (name) => name === "modalidad" ? "x3" : "LIGA DUPLICADA" },
    replies,
    deferReply: async () => {},
    deferUpdate: async () => {},
    reply: async (value) => { replies.push(value); return value; },
    editReply: async (value) => { replies.push(value); return value; },
    update: async (value) => { replies.push(value); return value; }
  };
};

test("/borrartorneo no ofrece confirmación si hay partidos o inscripciones", async () => {
  const inspect = db.inspectTournamentRemoval;
  const remove = db.removeTournament;
  let deleted = false;
  try {
    db.inspectTournamentRemoval = async () => ({ torneo: { id: "t1", nombre: "LIGA DUPLICADA" }, blockers: ["partidos"] });
    db.removeTournament = async () => { deleted = true; };
    const interaction = makeInteraction();
    await command.execute(interaction);
    assert.match(interaction.replies.at(-1).content, /tiene partidos/);
    assert.equal(interaction.replies.at(-1).components, undefined);
    assert.equal(deleted, false);
  } finally { db.inspectTournamentRemoval = inspect; db.removeTournament = remove; }
});

test("/borrartorneo exige confirmación del mismo admin y vuelve a verificar", async () => {
  const inspect = db.inspectTournamentRemoval;
  const remove = db.removeTournament;
  let deleted = false;
  try {
    db.inspectTournamentRemoval = async () => ({ torneo: { id: "t1", nombre: "LIGA DUPLICADA" }, blockers: [] });
    db.removeTournament = async () => { deleted = true; return { id: "t1" }; };
    const interaction = makeInteraction();
    await command.execute(interaction);
    const button = interaction.replies.at(-1).components[0].components[0];
    const token = button.data.custom_id.split(":")[2];
    const other = makeInteraction(); other.user.id = "intruso";
    await command.handleComponent(other, ["confirm", token]);
    assert.equal(deleted, false);
    assert.match(other.replies.at(-1).content, /Solo el administrador/);
    await command.handleComponent(interaction, ["confirm", token]);
    assert.equal(deleted, true);
    assert.match(interaction.replies.at(-1).content, /borrado/);
    assert.equal(oldCommand.execute, command.execute, "el nombre anterior no saltea la seguridad");
  } finally { db.inspectTournamentRemoval = inspect; db.removeTournament = remove; }
});
