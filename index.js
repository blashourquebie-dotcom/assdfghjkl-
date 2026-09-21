const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits } = require("discord.js");
const { initDB, readConfig, withGuild } = require("./utils/database");
const clubs = require("./utils/clubs");
const roleRegistry = require("./utils/roleRegistry");
const {
  pruneMissingForumClubLinks,
  removeForumClubLinkByChannel,
  restoreDeletedForumTemplate,
  auditLinkedForumTemplates,
  reconcileClubRosterFromRoles
} = require("./utils/plantillas");
const { handleMessage: handleAntiDfMessage } = require("./utils/antiDf");
const { processExpiredSanctions } = require("./utils/sanctions");
const {
  pruneExpiredTransferMessages
} = require("./utils/transfers");

// Importar handlers
const commandHandler = require("./handlers/commandHandler");
const interactionHandler = require("./handlers/interactionHandler");
const prefixHandler = require("./handlers/prefixHandler");
const webhookHandler = require("./handlers/webhookHandler");
const { startWebServer } = require("./utils/webServer");

const CRASH_DIR = path.join(__dirname, "logs");
const PID_FILE = path.join(CRASH_DIR, "bot.pid");

const ensureSingleInstance = () => {
  if (!fs.existsSync(CRASH_DIR)) fs.mkdirSync(CRASH_DIR, { recursive: true });

  if (fs.existsSync(PID_FILE)) {
    const existingPid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (existingPid && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0);
        console.error(`El bot ya esta prendido con PID ${existingPid}. Cerrando esta segunda instancia.`);
        process.exit(1);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }

  fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
};

const cleanupPidFile = () => {
  try {
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // No pasa nada si Windows ya cerro el proceso o el archivo.
  }
};

ensureSingleInstance();
process.on("exit", cleanupPidFile);
process.on("SIGINT", () => {
  cleanupPidFile();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupPidFile();
  process.exit(0);
});

const writeCrashLog = (title, error) => {
  try {
    if (!fs.existsSync(CRASH_DIR)) fs.mkdirSync(CRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const details = [
      `[${new Date().toISOString()}] ${title}`,
      error?.stack || error?.message || String(error)
    ].join("\n\n");
    fs.writeFileSync(path.join(CRASH_DIR, `crash-${stamp}.txt`), details, "utf8");
  } catch (logError) {
    console.error("No se pudo guardar el log de cierre:", logError);
  }
};

process.on("uncaughtException", (error) => {
  console.error("uncaughtException:", error);
  writeCrashLog("uncaughtException", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
  writeCrashLog("unhandledRejection", reason);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Message,
    Partials.Channel
  ]
});

client.on("messageCreate", async (message) => {
  if (!require('./utils/tournamentScope').allowedGuild(message.guild?.id)) return;
  if (!message?.guild || !message?.channel || message.author?.bot) return;
  return withGuild(message.guild.id, async () => {

  const antiDfResult = await handleAntiDfMessage(message).catch(() => ({ counted: false }));
  if (antiDfResult?.limitReached) {
    await message.channel.send({
      content: `ANTI-DF alcanzado: **${antiDfResult.thread.count}/${antiDfResult.thread.limit}** en **${antiDfResult.thread.modality}**`
    }).catch(() => null);
  }

  const cfg = readConfig();
  const antiSpam = cfg.automation?.antiSpam;
  if (!antiSpam?.enabled || !antiSpam?.channelId) return;
  if (String(message.channelId) !== String(antiSpam.channelId)) return;

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member || member.permissions?.has(PermissionFlagsBits.Administrator)) return;

  const cutoff = Date.now() - (60 * 60 * 1000);
  const recent = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (recent) {
    for (const msg of recent.values()) {
      if (msg.createdTimestamp < cutoff) continue;
      if (!msg.deletable) continue;
      await msg.delete().catch(() => null);
    }
  }

  await member.ban({ reason: "Anti spam automatico activado" }).catch(() => null);
  });
});

const auditAllGuildTemplates = async () => {
  for (const guild of client.guilds.cache.values()) {
    if (!require('./utils/tournamentScope').allowedGuild(guild.id)) continue;
    await withGuild(guild.id, async () => {
    const removed = await pruneMissingForumClubLinks(guild).catch((error) => {
      console.error(`Error limpiando foros vinculados en ${guild.name}:`, error);
      return [];
    });
    if (removed.length) console.log(`[${guild.name}] Limpieza de foros vinculados: ${removed.length}`);

    const audit = await auditLinkedForumTemplates(guild).catch((error) => {
      console.error(`Error auditando plantillas automaticas en ${guild.name}:`, error);
      return null;
    });
    if (audit) {
      console.log(`[${guild.name}] Plantillas auditadas: ${audit.checked}, reparadas: ${audit.repaired}, removidas: ${audit.removed}, omitidas: ${audit.skipped}`);
    }
    });
  }
};

const pruneAllGuildTransferMessages = async () => {
  for (const guild of client.guilds.cache.values()) {
    if (!require('./utils/tournamentScope').allowedGuild(guild.id)) continue;
    await withGuild(guild.id, () => pruneExpiredTransferMessages(client));
  }
};

const reconcileAllGuildRosters = async () => {
  for (const guild of client.guilds.cache.values()) {
    if (!require('./utils/tournamentScope').allowedGuild(guild.id)) continue;
    await withGuild(guild.id, async () => {
      const cfg = readConfig();
      await guild.members.fetch({ force: true }).catch(() => null);
      let added = 0;
      let removed = 0;
      let checked = 0;

      for (const [clubName, clubData] of Object.entries(cfg.clubs || {})) {
        const clubEntry = { name: clubName, ...clubData };
        for (const modality of Object.keys(clubEntry?.roles || {})) {
          const mod = roleRegistry.normalizeModality(modality);
          if (!mod) continue;
          const result = await reconcileClubRosterFromRoles(guild, clubs.findClub(clubName) || clubEntry, mod).catch(() => null);
          if (!result) continue;
          checked += 1;
          added += result.added;
          removed += result.removed;
        }
      }

      if (added || removed) {
        console.log(`[${guild.name}] Plantillas sincronizadas con roles: ${checked}, agregados: ${added}, fantasmas removidos: ${removed}`);
      }
    });
  }
};

// Validar variables de entorno
if (!process.env.TOKEN || !process.env.CLIENT_ID) {
  console.error("Faltan variables de entorno (TOKEN, CLIENT_ID)");
  process.exit(1);
}

const startBot = async () => {
  // Inicializar base de datos y cache remota antes de atender eventos.
  await initDB();

  // Levantar la web cuanto antes para que Railway exponga el puerto aun si Discord tarda.
  startWebServer(client).catch((error) => console.error("Error iniciando web:", error));

  client.once("ready", async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!require('./utils/tournamentScope').allowedGuild(guild.id)) {
        await guild.leave().catch(error => console.error('No se pudo salir del servidor no autorizado:', guild.id, error.message));
      }
    }
    console.log(`Bot conectado como ${client.user.tag}`);
    console.log(`Servidores activos: ${client.guilds.cache.map((guild) => `${guild.name} (${guild.id})`).join(", ")}`);

    const processFixtureBackups = require("./utils/fixtureBackups").createFixtureBackupWorker(client);
    const retryValidationReports=()=>require('./utils/antiDu').retryReports(client).catch(error=>console.error('Validation reports:',error.message));
    void retryValidationReports();
    setInterval(()=>void retryValidationReports(),30000);
    void processFixtureBackups().catch(error => console.error("Fixture backup:", error.message));
    setInterval(() => { void processFixtureBackups().catch(error => console.error("Fixture backup:", error.message)); }, 15000);
    await commandHandler(client);
    await auditAllGuildTemplates();

    await pruneAllGuildTransferMessages();
    await reconcileAllGuildRosters();
    await processExpiredSanctions(client).catch((error) => console.error("Error limpiando sanciones:", error));
    setInterval(() => {
      pruneAllGuildTransferMessages().catch((error) => console.error("Error limpiando traspasos vencidos:", error));
      processExpiredSanctions(client).catch((error) => console.error("Error limpiando sanciones:", error));
    }, 60 * 60 * 1000);
    setInterval(() => {
      reconcileAllGuildRosters().catch((error) => console.error("Error sincronizando plantillas con roles:", error));
    }, 15 * 60 * 1000);
    setInterval(() => {
      auditAllGuildTemplates().catch((error) => console.error("Error en auditoria periodica de plantillas:", error));
    }, 2 * 60 * 1000);
  });

  interactionHandler(client);
  prefixHandler(client);
  webhookHandler(client);
  require("./handlers/reportApprovalHandler")(client);
  client.on("guildCreate", async guild => {
    if (!require('./utils/tournamentScope').allowedGuild(guild.id)) {
      await guild.leave().catch(error => console.error('No se pudo salir del servidor no autorizado:', guild.id, error.message));
      return;
    }
    await commandHandler(client);
  });

  client.on("channelDelete", (channel) => {
    if (!require('./utils/tournamentScope').allowedGuild(channel.guild?.id || channel.guildId)) return;
    const removed = withGuild(channel.guild?.id || channel.guildId, () => removeForumClubLinkByChannel(channel.id));
    if (removed) console.log(`Foro desvinculado por eliminacion de canal: ${channel.id}`);
  });

  client.on("messageDelete", async (message) => {
    if (!require('./utils/tournamentScope').allowedGuild(message.guild?.id || message.guildId)) return;
    const restored = await withGuild(message.guild?.id || message.guildId, () =>
      restoreDeletedForumTemplate(message)
    ).catch(() => false);
    if (restored) console.log(`Plantilla restaurada en foro vinculado: ${message.channelId}`);
  });

  client.on("messageDeleteBulk", async (messages) => {
    for (const message of messages.values()) {
      if (!require('./utils/tournamentScope').allowedGuild(message.guild?.id || message.guildId)) continue;
      const restored = await withGuild(message.guild?.id || message.guildId, () =>
        restoreDeletedForumTemplate(message)
      ).catch(() => false);
      if (restored) console.log(`Plantilla restaurada en foro vinculado tras purge: ${message.channelId}`);
    }
  });

  await client.login(process.env.TOKEN);
};

startBot().catch((error) => {
  console.error("No se pudo iniciar el bot:", error);
  writeCrashLog("startup", error);
  process.exit(1);
});
