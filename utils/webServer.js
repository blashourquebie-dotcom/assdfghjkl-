const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const statsStore = require("./statsStore");
const seasons = require("./seasons");
const roleRegistry = require("./roleRegistry");
const { readConfig, withGuild } = require("./database");
const officials = require("./officials");
const clubs = require("./clubs");
const webhookHandler = require("../handlers/webhookHandler");

const DEFAULT_WEB_ROOT = path.resolve(__dirname, "..", "..", "HaxOleWeb-V2.0.3", "public");
const WEB_ROOT = process.env.WEB_ROOT ? path.resolve(process.env.WEB_ROOT) : DEFAULT_WEB_ROOT;
const PORT = Number(process.env.PORT || process.env.WEB_PORT || 3000);
const HOST = process.env.WEB_HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
  "Vary": "Origin"
});

const writeJson = (res, statusCode, data) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders()
  });
  res.end(JSON.stringify(data, null, 2));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!chunks.length) return resolve({});
    try {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) : {});
    } catch (error) {
      reject(error);
    }
  });
  req.on("error", reject);
});

const maskValue = (value) => {
  const text = String(value || "");
  if (!text) return null;
  if (text.length <= 6) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 3)}…${text.slice(-3)}`;
};

const resolveGuildId = (url, client) => {
  const requested = url.searchParams.get("guildId");
  if (requested) return requested;
  return client.guilds.cache.size === 1 ? client.guilds.cache.first()?.id || null : null;
};

const getSeason = (guildId, modality, seasonName) => {
  if (!seasonName) return null;
  return seasons.findSeason({ name: seasonName, modality, includeFinished: true });
};

const publicClubData = (cfg) => {
  return Object.values(cfg.clubs || {}).map((club) => ({
    name: club.name,
    abbr: club.abbr,
    emoji: club.emoji || null,
    modalities: Object.keys(club.roles || {}),
    captains: Object.keys(club.captains || {}),
    subcaptains: Object.keys(club.subcaptains || {})
  }));
};

const publicOfficialSummary = (guildId) => {
  const sessions = officials.listPendingSessions(guildId).map((session) => ({
    id: session.id,
    validationId: session.validationId || null,
    playerName: session.playerName,
    room: session.room,
    matchedBy: session.matchedBy,
    matchedUserId: session.matchedUserId,
    status: session.status,
    createdAt: session.createdAt,
    auth: maskValue(session.auth),
    conn: maskValue(session.conn),
    ip: maskValue(session.ip)
  }));

  return {
    pending: sessions.filter((session) => session.status === "pending"),
    confirmed: sessions.filter((session) => session.status === "confirmed").slice(0, 20)
  };
};

const readValidationId = (pathname, url) => {
  const fromPath = String(pathname || "").slice("/api/officials/validation/".length).trim();
  const fromQuery = String(url?.searchParams?.get("validationId") || "").trim();
  return decodeURIComponent(fromPath || fromQuery || "");
};

const startWebServer = async (client) => {
  if (global.__haxoleWebServer) return global.__haxoleWebServer;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(url.pathname);

      Object.entries(corsHeaders()).forEach(([key, value]) => res.setHeader(key, value));

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        return res.end();
      }

      if (pathname.startsWith("/api/")) {
        const guildId = resolveGuildId(url, client);
        if (!require('./tournamentScope').allowedGuild(guildId)) return writeJson(res, 403, { error: 'Servidor no autorizado' });
        if (pathname === '/api/officials/notify-host') return require('./hostReports').handle(req,res,guildId,client,writeJson);
        if (pathname === '/api/officials/live-match') return require('./liveMatches').handle(req,res,guildId,writeJson);
        if (pathname === '/api/officials/live-replay') return require('./liveReplays').handle(req,res,guildId,url,writeJson);
        const cfg = withGuild(guildId, readConfig);

        if (pathname === "/api/status") {
          return writeJson(res, 200, {
            guildId,
            summary: officials.buildPublicSummary(),
            clubs: Object.keys(cfg.clubs || {}).length,
            forums: Object.keys(cfg.forumClubs || {}).length,
            modalities: roleRegistry.getEnabledModalities(cfg),
            pendingOfficialSessions: officials.listPendingSessions(guildId).filter((session) => session.status === "pending").length,
            generatedAt: new Date().toISOString()
          });
        }

        if (pathname === "/api/clubs") {
          return writeJson(res, 200, {
            guildId,
            clubs: publicClubData(cfg)
          });
        }

        if (pathname === "/api/tiers") {
          const modalityRaw = url.searchParams.get("modalidad") || "general";
          const seasonName = url.searchParams.get("temporada");
          const scope = String(modalityRaw).toLowerCase() === "general" ? null : roleRegistry.normalizeModality(modalityRaw);
          const season = getSeason(guildId, scope, seasonName);
          const rows = statsStore.aggregateTierPoints({
            modality: scope,
            seasonId: season?.id || null
          }).slice(0, 30).map((row) => ({
            userId: row.userId,
            displayName: row.displayName || row.userTag || null,
            userTag: row.userTag,
            clubName: row.clubName,
            clubEmoji: row.clubEmoji,
            modalities: row.modalities,
            points: Number(row.points) || 0
          }));

          return writeJson(res, 200, {
            guildId,
            scope: scope || "general",
            season: season ? { id: season.id, name: season.name, displayName: season.displayName } : null,
            rows
          });
        }

        if (pathname === "/api/stats") {
          const modality = roleRegistry.normalizeModality(url.searchParams.get("modalidad"));
          const type = statsStore.normalizeStatType(url.searchParams.get("tipo"));
          const division = url.searchParams.get("division") || null;
          const seasonName = url.searchParams.get("temporada") || null;
          const season = seasonName ? seasons.findSeason({ name: seasonName, modality, includeFinished: true }) : null;
          const rows = statsStore.aggregate({
            modality,
            statType: type,
            division,
            seasonId: season?.id || null
          }).slice(0, 30);

          return writeJson(res, 200, {
            guildId,
            modality,
            type,
            division,
            season: season ? { id: season.id, name: season.name, displayName: season.displayName } : null,
            rows
          });
        }

        if (pathname === "/api/officials/health") {
          return writeJson(res, 200, {
            ok: true,
            guildId,
            pendingSessions: officials.listPendingSessions(guildId).length,
            generatedAt: new Date().toISOString()
          });
        }

        if (pathname.startsWith("/api/officials/validation/")) {
          const validationId = readValidationId(pathname, url);
          if (!validationId) {
            return writeJson(res, 400, { error: "Validation id missing" });
          }
          const session = officials.getPendingSessionByValidationId(validationId,guildId);
          if (!session || String(session.guildId) !== String(guildId)) {
            console.log("[webServer] validation no encontrada:", { validationId });
            return writeJson(res, 404, {
              error: "Validation not found",
              validationId,
              hint: "Verifica que el webhook notify-validation haya llegado y que el validationId coincida."
            });
          }
          if(session.status==='confirmed')void require('./antiDu').recordValidation(client,session).catch(error=>console.error('[antiDu]',error.message));
          return writeJson(res, 200, {
            validationId: session.validationId || null,
            session: {
              id: session.id,
              guildId: session.guildId,
              channelId: session.channelId,
              messageId: session.messageId,
              playerName: session.playerName,
              room: session.room,
              matchedBy: session.matchedBy,
              matchedUserId: session.matchedUserId,
              status: session.status,
              createdAt: session.createdAt,
              confirmedAt: session.confirmedAt,
              rejectedAt: session.rejectedAt,
              decidedBy: session.decidedBy,
              auth: maskValue(session.auth),
              conn: maskValue(session.conn),
              ip: maskValue(session.ip)
            }
          });
        }

        if (pathname === "/api/officials") {
          return writeJson(res, 200, {
            guildId,
            ...publicOfficialSummary(guildId)
          });
        }

        if (pathname === "/api/officials/notify-validation" && req.method === "POST") {
          const body = await readJsonBody(req).catch(() => null);
          if (!body) {
            return writeJson(res, 400, { error: "Invalid JSON body" });
          }

          console.log("[webServer] notify-validation recibido:", {
            playerName: body.playerName || null,
            validationId: body.validationId || null,
            auth: body.auth || null
          });

          if (body.guildId && String(body.guildId) !== String(guildId)) return writeJson(res, 400, { error: "El servidor del cuerpo no coincide con el de la URL", code: "GUILD_MISMATCH" });
          if (!client.guilds.cache.has(String(guildId))) return writeJson(res, 400, { error: "Este bot no está conectado al servidor indicado. Revisá la aplicación de Discord desplegada en Railway y su pertenencia a la liga.", code: "GUILD_UNAVAILABLE" });
          const result = await webhookHandler.processOfficialPayload(client, {
            room: body.room || "Validacion oficial",
            playerName: body.playerName,
            auth: body.auth || null,
            conn: body.conn || null,
            ip: body.ip || null,
            mode: body.mode || null,
            official: body.official || null,
            validationId: body.validationId || null,
            autoValidation: body.autoValidation === true,
            hostContext: require('./hostValidationContext').normalizeHostContext(body.hostContext)
          }, {
            guildId: body.guildId || guildId || null,
            channelId: body.channelId || "api",
            messageId: body.messageId || null,
            source: "direct-api"
          });

          console.log("[webServer] notify-validation procesado:", {
            validationId: body.validationId || null,
            sessionId: result?.session?.id || null,
            matchedUserId: result?.match?.userId || null,
            matchedBy: result?.match?.reason || null,
            skipped: Boolean(result?.skipped)
          });

          return writeJson(res, 200, {
            ok: true,
            processed: Boolean(result),
            matchedUserId: result?.match?.userId || null,
            matchedBy: result?.match?.reason || null,
            sessionId: result?.session?.id || null,
            validationId: result?.session?.validationId || null,
            status: result?.session?.status || null,
            // Host network context belongs only in staff reports, not API responses.
            result: result ? { ...result, session: result.session ? { ...result.session, hostContext: undefined } : result.session } : result
          });
        }

        return writeJson(res, 404, { error: "Not found" });
      }

      const safePath = pathname === "/" ? "/index.html" : pathname;
      const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.resolve(WEB_ROOT, `.${normalized}`);
      if (!filePath.startsWith(WEB_ROOT)) {
        res.writeHead(403, {
          "Content-Type": "text/plain; charset=utf-8",
          ...corsHeaders()
        });
        return res.end("Forbidden");
      }

      const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      if (!exists) {
        res.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
          ...corsHeaders()
        });
        return res.end("Not found");
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        ...corsHeaders()
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error("[webServer] error:", error);
      if (!res.headersSent) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders()
        });
      }
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  await new Promise((resolve) => {
    server.listen(PORT, HOST, () => resolve());
  });

  global.__haxoleWebServer = server;
  console.log(`Web activa en http://${HOST}:${PORT} (root: ${WEB_ROOT})`);
  return server;
};

module.exports = {
  startWebServer
};
