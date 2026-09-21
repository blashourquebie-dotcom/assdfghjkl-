const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/i);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const haxoleSupabase = require("../utils/haxoleSupabase");

const main = async () => {
  if (!haxoleSupabase.isEnabled) {
    throw new Error("Supabase no esta habilitado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }

  const modality = "x3";
  const testName = `__codex_smoke_${Date.now()}`;
  const channelId = "999999999999999999";
  const messageId = "888888888888888888";
  const guildId = "777777777777777777";

  const created = await haxoleSupabase.ensureTournament({
    modality,
    name: testName,
    cantidad_equipos: 3,
    modo_copa: false,
    tipo: "exclusivo"
  });

  if (!created?.id) {
    throw new Error("No se pudo crear el torneo de prueba.");
  }

  await haxoleSupabase.setTournamentForumLink({
    modality,
    name: testName,
    channelId,
    messageId,
    guildId
  });

  const byName = await haxoleSupabase.getTournament({ modality, name: testName });
  const byChannel = await haxoleSupabase.getTournamentByForumChannel(channelId);
  const list = await haxoleSupabase.listTorneosByModalidad(modality);

  await haxoleSupabase.removeTournament({ modality, name: testName });

  const stillExistsAfterDelete = await haxoleSupabase.getTournament({ modality, name: testName });

  console.log(JSON.stringify({
    created: Boolean(created?.id),
    readByName: Boolean(byName?.id),
    readByChannel: Boolean(byChannel?.id),
    listContainsTest: list.some((item) => item.id === created.id),
    cleanedUp: !stillExistsAfterDelete,
    torneoId: created.id
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
