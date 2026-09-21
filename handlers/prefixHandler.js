const fs = require('fs');
const path = require('path');

// Carga todos los comandos de la carpeta commands
const commandsPath = path.join(__dirname, '..', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
const commands = {};
for (const file of commandFiles) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd.disabled) continue;
  if (cmd.data && cmd.data.name && typeof cmd.execute === 'function') {
    commands[cmd.data.name] = cmd;
  }
}

const { readConfig, withGuild } = require('../utils/database');
const commandAccess = require('../utils/commandAccess');

const TEMP_REPLY_MS = 10000;

const scheduleDelete = (msg, ms = TEMP_REPLY_MS) => {
  if (!msg?.delete) return;
  setTimeout(() => {
    msg.delete().catch(() => null);
  }, ms);
};

const sendPrefixResponse = async (message, payload) => {
  payload = require("../utils/embedResponses").toEmbedPayload(payload);
  try {
    return await message.reply(payload);
  } catch (error) {
    const isMissingReference = error?.code === 50035 || error?.code === 10008;
    if (!isMissingReference) throw error;
    return message.channel?.send(payload);
  }
};

const ALIASES = {
  h: 'habilitarclub',
  hc: 'habilitarclub',
  habilitarc: 'habilitarclub',
  help: 'help',
  habilitar: 'habilitarclub',
  deshabilitar: 'deshabilitarclub',
  d: 'deshabilitarclub',
  fc: 'foroclub',
  dfc: 'desvincularclubforo',
  desvincularforo: 'desvincularclubforo',
  f: 'ficho',
  ficho: 'ficho',
  firmo: 'ficho',
  subo: 'ficho',
  c: 'cancelo',
  canc: 'cancelo',
  cancel: 'cancelo',
  cancell: 'cancelo',
  cancelo: 'cancelo',
  cc: 'cedercap',
  ce: 'cedercap',
  cederc: 'cedercap',
  subcap: 'sc',
  subcapitan: 'sc',
  pc: 'prefixchange',
  prefix: 'prefixchange',
  vc: 'vinclub',
  vinc: 'vinclub',
  e: 'entry',
  entry: 'entry',
  lpjs: 'limit',
  lsc: 'limitsc',
  left: 'left',
  '1ra': 'primera',
  primera: 'primera',
  '2da': 'segunda',
  segunda: 'segunda',
  asc: 'ascender',
  desc: 'descender',
  cs: 'cs',
  chargestat: 'cs',
  cargarstat: 'cargarstat',
  valuar: 'valuar',
  habilitarpack: 'habilitarpack',
  tiers: 'tiers',
  tier: 'tiers',
  server: 'server',
  refresh: 'refresh',
  rr: 'refresh',
  sincronizarroles: 'refresh',
  ar: 'argentina',
  br: 'brasil',
  py: 'paraguay',
  uy: 'uruguay',
  ch: 'chile',
  cl: 'chile',
  bl: 'bolivia',
  bo: 'bolivia',
  pe: 'peru',
  peru: 'peru',
  ot: 'otro',
  nicks: 'nicks',
  auths: 'auths',
  ficha: 'ficho'
};

const DISABLED_COMMANDS = new Set(['historial', 'refreshnicknames', 'resetnicks', 'resetear', 'help', 'info', 'configuracion']);
const NATURAL_CANCEL_WORDS = new Set([
  'canc',
  'cancel',
  'cancell',
  'cancelo',
  'cancelar',
  'cancelacion',
  'cancelado',
  'cencel',
  'cencelo',
  'cansel',
  'canselo'
]);
const NATURAL_FICHO_WORDS = new Set([
  'firmo',
  'firm',
  'frmo',
  'frm',
  'ficha',
  'firmar'
]);
const COUNTRY_COMMANDS = new Set(['argentina', 'brasil', 'paraguay', 'uruguay', 'chile', 'bolivia', 'peru', 'otro']);

const normalizeNaturalCommand = (raw) => String(raw || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/^[!¡¿?.,;:-]+|[!¡¿?.,;:]+$/g, "");

const getNaturalCancelCommand = (message, cfg) => {
  if (!cfg.forumClubs?.[message.channel?.id] && !cfg.forumClubs?.[message.channel?.parentId]) return null;
  const firstWord = normalizeNaturalCommand(String(message.content || "").split(/\s+/)[0]);
  return NATURAL_CANCEL_WORDS.has(firstWord) ? "cancelo" : null;
};

const isFichajeRequestMessage = (message, cfg) => {
  if (!cfg.forumClubs?.[message.channel?.id] && !cfg.forumClubs?.[message.channel?.parentId]) return false;
  if (/^[!¡]/.test(String(message.content || "").trim())) return false;
  const firstWord = normalizeNaturalCommand(String(message.content || "").split(/\s+/)[0]);
  return NATURAL_FICHO_WORDS.has(firstWord);
};

const parseArgs = (input) => {
  const args = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input))) args.push(match[1] ?? match[2] ?? match[3]);
  return args;
};

const splitClubAndModality = (raw) => {
  const value = String(raw || '').trim();
  const comma = value.match(/^(.*?),\s*([^,]+)$/);
  if (comma) return { club: comma[1].trim(), modalidad: comma[2].trim() };
  const args = parseArgs(value);
  const modalidad = args.pop() || null;
  return { club: args.join(' ').trim(), modalidad };
};

const parseEntryArgs = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return { torneo: null, replaceClub: null };
  const stripQuotes = (text) => String(text || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();

  const comma = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (comma.length >= 2) {
    const torneo = stripQuotes(comma[0]) || null;
    const replaceClub = stripQuotes(
      comma.slice(1).join(', ').replace(/^(?:x|reemplazar|swap)\s+/i, '')
    ) || null;
    return { torneo, replaceClub };
  }

  const match = value.match(/^(.*?)\s+(?:x|reemplazar|swap)\s+(.+)$/i);
  if (match) {
    return {
      torneo: stripQuotes(match[1]) || null,
      replaceClub: stripQuotes(match[2]) || null
    };
  }

  return { torneo: stripQuotes(value) || null, replaceClub: null };
};

const splitCsvArgs = (raw) => String(raw || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);

const cleanOptionValue = (value) => {
  const text = String(value || "").trim();
  if (/^-?\d+$/.test(text)) return text;
  return text
    .replace(/^-+|-+$/g, "")
    .replace(/^(modalidad|cantidad|max|dias?|d[ií]as|club|emoji|usuario|capitan|capit[aá]n):/i, "")
    .trim();
};

const stripUserMentions = (value) => String(value || "")
  .replace(/<@!?\d+>|\b\d{15,25}\b/g, "")
  .trim();

const getNamedArg = (rawArgs, names) => {
  const pattern = new RegExp(`(?:^|[\\s,;-])(?:${names.join("|")}):\\s*([^\\s,;-]+(?:,[^\\s;-]+)*)`, "i");
  const match = String(rawArgs || "").match(pattern);
  return match ? cleanOptionValue(match[1]) : null;
};

const buildOptionMap = (commandName, rawArgs, args) => {
  const optionMap = {};
  const cleanedArgs = args.map(cleanOptionValue).filter(Boolean);

  if (commandName === 'habilitarclub') {
    const capitan = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/) || [null])[0];
    const withoutUsers = stripUserMentions(rawArgs).replace(/[,\s]+$/g, "");
    const csv = splitCsvArgs(withoutUsers);
    if (csv.length >= 3) {
      optionMap.club = csv[0] || null;
      optionMap.abreviacion = csv[1] || null;
      optionMap.modalidades = csv.slice(2).join(',') || null;
    } else {
      const cleanedNoUsers = parseArgs(withoutUsers).map(cleanOptionValue).filter(Boolean);
      const modalityStart = cleanedNoUsers.findIndex((part) => /^x\d+$/i.test(part) || /^rs[-_]?x\d+$/i.test(part));
      if (modalityStart > 1) {
        optionMap.club = cleanedNoUsers.slice(0, modalityStart - 1).join(" ") || null;
        optionMap.abreviacion = cleanedNoUsers[modalityStart - 1] || null;
        optionMap.modalidades = cleanedNoUsers.slice(modalityStart).join(",") || null;
      } else {
        optionMap.modalidades = cleanedNoUsers[cleanedNoUsers.length - 1] || null;
        optionMap.abreviacion = cleanedNoUsers[cleanedNoUsers.length - 2] || null;
        optionMap.club = cleanedNoUsers.slice(0, -2).join(' ') || cleanedNoUsers[0] || null;
      }
    }
    optionMap.otramodalidad = getNamedArg(rawArgs, ["otramodalidad", "otra"]) || null;
    optionMap.capitan = capitan;
  } else if (commandName === 'cap') {
    optionMap.usuario = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/) || [null])[0];
    optionMap.usuarios = optionMap.usuario || null;
    const withoutUsers = stripUserMentions(rawArgs).replace(/^[,\s]+|[,\s]+$/g, "");
    const parts = parseArgs(withoutUsers).map(cleanOptionValue).filter(Boolean);
    optionMap.club = parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
    optionMap.modalidades = parts.length ? parts[parts.length - 1] : null;
    optionMap.modalidad = optionMap.modalidades;
  } else if (commandName === 'club') {
    optionMap.club = rawArgs || args.join(' ') || null;
  } else if (commandName === 'plantilla' || commandName === 'foroclub') {
    const parsed = splitClubAndModality(rawArgs);
    optionMap.club = parsed.club;
    optionMap.modalidad = parsed.modalidad;
  } else if (commandName === 'desvincularclubforo') {
    const parsed = splitClubAndModality(rawArgs);
    optionMap.club = parsed.club || null;
    optionMap.modalidad = parsed.modalidad || null;
    optionMap.foro = null;
  } else if (commandName === 'deshabilitarclub') {
    const parsed = splitClubAndModality(rawArgs);
    optionMap.club = parsed.club || args[0] || null;
    optionMap.modalidades = parsed.modalidad || args.slice(1).join(' ') || null;
  } else if (commandName === 'fichar' || commandName === 'cancelar') {
    optionMap.usuarios = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/g) || []).join(', ');
    const withoutUsers = rawArgs.replace(/<@!?\d+>|\b\d{15,25}\b/g, '').replace(/^[,\s]+|[,\s]+$/g, '');
    const parsed = splitClubAndModality(withoutUsers);
    optionMap.club = parsed.club || null;
    optionMap.modalidad = parsed.modalidad || null;
  } else if (commandName === 'ficho' || commandName === 'cancelo') {
    optionMap.usuarios = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/g) || []).join(', ') || null;
  } else if (COUNTRY_COMMANDS.has(commandName)) {
    optionMap.usuario = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/) || [null])[0];
  } else if (commandName === 'cedercap' || commandName === 'sc' || commandName === 'cederfichajes') {
    const forumLink = null;
    optionMap.usuario = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/) || [null])[0];
    optionMap.usuarios = optionMap.usuario || null;
    const argParts = args
      .filter((part) => !/<@!?\d+>|\b\d{15,25}\b/.test(part))
      .map(cleanOptionValue)
      .filter(Boolean);
    if (commandName === 'cedercap') {
      optionMap.cancelar = argParts.some((part) => /^(cancelar|cancelo|cancel|true|si|s[ií])$/i.test(part));
    }
    const meaningfulParts = argParts.filter((part) => !/^(cancelar|cancelo|cancel|true|si|s[ií])$/i.test(part));
    optionMap.club = meaningfulParts.slice(0, -1).join(' ') || null;
    optionMap.modalidad = meaningfulParts[meaningfulParts.length - 1] || null;
  } else if (commandName === 'limit' || commandName === 'checklimit') {
    optionMap.tipo = ['sc', 'club'].includes(String(cleanedArgs[0] || '').toLowerCase()) ? String(cleanedArgs[0]).toLowerCase() : null;
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.max = parseInt(getNamedArg(rawArgs, ["max", "cantidad"]) || cleanedArgs[1], 10) || null;
  } else if (commandName === 'limitsc') {
    optionMap.max = parseInt(getNamedArg(rawArgs, ["max", "cantidad"]) || cleanedArgs[0], 10) || null;
  } else if (commandName === 'vincularalertas') {
    optionMap.canal = null;
  } else if (commandName === 'prefixchange') {
    optionMap.prefijo = args[0] || null;
  } else if (commandName === 'purge') {
    optionMap.cantidad = args[0] ? parseInt(args[0], 10) : null;
  } else if (commandName === 'vinclub') {
    optionMap.club = args.length > 1 ? args.slice(0, -1).join(' ') : null;
    optionMap.emoji = args[args.length - 1] || null;
  } else if (commandName === 'creartorneo') {
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.torneo = getNamedArg(rawArgs, ["torneo", "nombre"]) || cleanedArgs.slice(1, -2).join(" ") || cleanedArgs[1] || null;
    optionMap.cantidad_equipos = parseInt(getNamedArg(rawArgs, ["cantidad_equipos", "cantidad", "equipos"]) || cleanedArgs.find((arg) => /^\d+$/.test(arg)), 10) || null;
    const modoCopa = getNamedArg(rawArgs, ["modo_copa"]);
    optionMap.modo = (
      getNamedArg(rawArgs, ["modo", "tipo_modo"])
      || (modoCopa && /^(true|1|si|sí|on|copa|mata[\s_-]*mata)$/i.test(modoCopa) ? "copa" : null)
      || (/\bcopa\b/i.test(rawArgs) ? "copa" : null)
      || (/\bliga\b/i.test(rawArgs) ? "liga" : null)
      || null
    );
    optionMap.tipo = getNamedArg(rawArgs, ["tipo"]) || null;
  } else if (commandName === 'server') {
    optionMap.nombre = getNamedArg(rawArgs, ["nombre", "server", "servidor"]) || cleanedArgs.join(" ") || null;
  } else if (commandName === 'eliminartorneo') {
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.torneo = getNamedArg(rawArgs, ["torneo", "nombre"]) || cleanedArgs.slice(1).join(" ") || null;
  } else if (commandName === 'vincularinformes') {
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.torneo = getNamedArg(rawArgs, ["torneo", "nombre"]) || cleanedArgs.slice(1).join(" ") || null;
  } else if (commandName === 'entry') {
    const parsedEntry = parseEntryArgs(rawArgs);
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || null;
    optionMap.torneo = getNamedArg(rawArgs, ["torneo", "nombre"]) || parsedEntry.torneo || cleanedArgs.join(" ") || null;
    optionMap.club_a_reemplazar = getNamedArg(rawArgs, ["club_a_reemplazar", "reemplazar", "swap"]) || parsedEntry.replaceClub || null;
  } else if (commandName === 'refresh') {
    optionMap.modalidades = getNamedArg(rawArgs, ["modalidades"]) || splitCsvArgs(rawArgs).join(",") || cleanedArgs.join(",");
  } else if (commandName === 'cargarstat') {
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.torneo = getNamedArg(rawArgs, ["torneo", "nombre"]) || cleanedArgs.slice(1, -1).join(" ") || cleanedArgs[1] || null;
    optionMap.fecha = parseInt(getNamedArg(rawArgs, ["fecha"]) || cleanedArgs.find((arg) => /^\d+$/.test(arg)), 10) || null;
    optionMap.reporte = null;
  } else if (commandName === 'mercado') {
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.cantidad = parseInt(getNamedArg(rawArgs, ["cantidad", "max"]) || cleanedArgs[1], 10) || null;
    optionMap.dias = getNamedArg(rawArgs, ["dias", "días", "dia", "día"]) || cleanedArgs.slice(2).join(',') || null;
  } else if (commandName === 'abrirmercado' || commandName === 'cerrarmercado') {
    optionMap.modalidad = getNamedArg(rawArgs, ["modalidad"]) || cleanedArgs[0] || null;
    optionMap.tiempo = getNamedArg(rawArgs, ["tiempo", "duracion", "duración"]) || cleanedArgs.slice(1).join(" ") || null;
  } else if (commandName === 'help') {
    optionMap.comando = cleanedArgs[0] || null;
  } else if (commandName === 'sancionar') {
    optionMap.usuarios = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/g) || []).join(', ');
    const withoutUsers = rawArgs.replace(/<@!?\d+>|\b\d{15,25}\b/g, '').replace(/^[,\s]+|[,\s]+$/g, '');
    const parts = withoutUsers.split(/\s+/).filter(Boolean);
    optionMap.tiempo = parts[0] || null;
    optionMap.razon = parts.slice(1).join(' ') || null;
  } else if (commandName === 'clearsancion') {
    optionMap.usuarios = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/g) || []).join(', ');
    const withoutUsers = rawArgs.replace(/<@!?\d+>|\b\d{15,25}\b/g, '').replace(/^[,\s]+|[,\s]+$/g, '');
    optionMap.tiempo = withoutUsers.split(/\s+/).filter(Boolean)[0] || null;
  } else if (commandName === 'resetear') {
    optionMap.modalidades = splitCsvArgs(rawArgs).length > 1
      ? splitCsvArgs(rawArgs).join(',')
      : cleanedArgs.join(',');
  } else if (commandName === 'permisosbot') {
    optionMap.subcommand = cleanedArgs[0] || null;
    optionMap.usuario = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/) || [null])[0];
  } else if (commandName === 'nicks') {
    optionMap.subcommand = cleanedArgs[0] || "refresh";
    optionMap.usuario = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/) || [null])[0];
    optionMap.usuarios = (rawArgs.match(/<@!?\d+>|\b\d{15,25}\b/g) || []).join(', ') || null;
    optionMap.limit = parseInt(cleanedArgs.find((arg) => /^\d+$/.test(arg)), 10) || null;
  }

  return optionMap;
};

const looksLikeReportLoad = (body) => {
  const text = String(body || "").trim();
  if (!text) return false;

  const lines = text
    .replace(/\u00A0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return false;

  const hasScore = lines.some((line) => /\d+\s*-\s*\d+/.test(line));
  const hasReportTokens = lines.some((line) => /^(?:<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s*(?:g|a|v|goles|asistencias|valla|figura|mvp|dest)/i.test(line));
  const hasRepeatedMentions = (text.match(/<@!?\d+>/g) || []).length >= 3;
  const hasReplay = /\brec\s*:/i.test(text) || /replayId=/i.test(text);

  return hasScore || hasReportTokens || hasRepeatedMentions || hasReplay;
};

module.exports = async (client) => {
  client.on('messageCreate', async (message) => {
    if (!require('../utils/tournamentScope').allowedGuild(message.guild?.id)) return;
    return withGuild(message.guild?.id || null, async () => {
    if (message.author.bot) return;
    const cfg = readConfig();
    const PREFIXES = (cfg.meta && cfg.meta.prefix) ? cfg.meta.prefix : ['¡','!'];
    const prefix = PREFIXES.find(p => message.content.startsWith(p));
    const naturalCommandName = prefix ? null : getNaturalCancelCommand(message, cfg);
    if (!prefix && !naturalCommandName) return;
    const body = prefix ? message.content.slice(prefix.length).trim() : naturalCommandName;
    const parsedArgs = parseArgs(body);
    const rawCommandName = (parsedArgs.shift() || '').toLowerCase();
    const commandName = ALIASES[rawCommandName] || rawCommandName;
    const rawCommandBody = body.slice(rawCommandName.length).trim();
    const effectiveCommandName = commandName === 'cs' && looksLikeReportLoad(rawCommandBody)
      ? 'cargarstat'
      : commandName;
    if (DISABLED_COMMANDS.has(commandName)) {
      const disabledReply = await sendPrefixResponse(message, "Este comando esta deshabilitado por el momento.").catch(() => null);
      if (disabledReply) scheduleDelete(disabledReply);
      setTimeout(() => {
        message.delete().catch(() => null);
      }, 10000);
      return;
    }
    const command = commands[effectiveCommandName];
    if (!command) return;
    const rawArgs = prefix ? body.slice(rawCommandName.length).trim() : "";
    const optionMap = buildOptionMap(effectiveCommandName, rawArgs, [...parsedArgs]);
    optionMap.liga = getNamedArg(rawArgs, ['liga']) || null;
    const shiftedArgs = [...parsedArgs];
    let repliedMessage = null;
    const keepMessages = !prefix;
    if (!keepMessages) {
      setTimeout(() => {
        message.delete().catch(() => null);
      }, 10000);
    }

    // Simula interaction para compatibilidad
    const fakeInteraction = {
      user: message.author,
      member: message.member,
      guild: message.guild,
      channel: message.channel,
      sourceMessage: message,
      deferred: false,
      replied: false,
      options: {
        getSubcommand: () => optionMap.subcommand || shiftedArgs.shift() || null,
        getUser: (name) => {
          // Busca primer mención o primer arg que sea @
          const mention = message.mentions.users.first();
          if (mention) return mention;
          const raw = optionMap[name];
          const id = String(raw || '').match(/\d{15,25}/)?.[0];
          if (id) return { id, tag: `<@${id}>`, username: id };
          return null;
        },
        getString: (name) => {
          if (name === 'liga') return optionMap.liga;
          if (commandName === 'entry') {
            if (name === 'modalidad' || name === 'modalidades') {
              return optionMap[name] || (cfg.forumClubs?.[message.channel.id] || cfg.forumClubs?.[message.channel.parentId])?.modality || null;
            }
            if (name === 'club') {
              return optionMap.club || (cfg.forumClubs?.[message.channel.id] || cfg.forumClubs?.[message.channel.parentId])?.club || null;
            }
            if (name === 'torneo') {
              return optionMap.torneo || null;
            }
            if (name === 'club_a_reemplazar') {
              return optionMap.club_a_reemplazar || null;
            }
          }
          if ((commandName === 'cap' || commandName === 'cedercap' || commandName === 'sc' || commandName === 'cederfichajes' || commandName === 'vinclub' || commandName === 'entry' || commandName === 'cs' || commandName === 'cargarstat') && (name === 'club' || name === 'modalidad' || name === 'modalidades')) {
            const link = cfg.forumClubs?.[message.channel.id] || cfg.forumClubs?.[message.channel.parentId];
            if (link && (optionMap[name] === undefined || optionMap[name] === null || optionMap[name] === "")) {
              return name === 'club' ? link.club : link.modality;
            }
          }
          if (Object.prototype.hasOwnProperty.call(optionMap, name) && optionMap[name] !== undefined && optionMap[name] !== null && optionMap[name] !== "") return optionMap[name];
          return shiftedArgs.shift() || null;
        },
        getRole: (name) => {
          // Busca primer mención de rol
          const mention = message.mentions.roles.first();
          if (mention) return mention;
          return null;
        },
        getInteger: (name) => {
          if (Object.prototype.hasOwnProperty.call(optionMap, name)) return optionMap[name];
          const val = shiftedArgs.shift();
          return val ? parseInt(val, 10) : null;
        },
        getBoolean: (name) => {
          if (Object.prototype.hasOwnProperty.call(optionMap, name)) return Boolean(optionMap[name]);
          return false;
        },
        getChannel: (name) => {
          return message.mentions.channels.first() || message.channel;
        }
      },
      deferReply: async () => {
        fakeInteraction.deferred = true;
      },
      reply: async (payload) => {
        const { content, embeds, files, components, flags } = typeof payload === "string" ? { content: payload } : payload;
        fakeInteraction.replied = true;
        if (embeds || files || components) repliedMessage = await sendPrefixResponse(message, { content, embeds, files, components, flags });
        else repliedMessage = await sendPrefixResponse(message, content);
        if (flags === 64 && !keepMessages) scheduleDelete(repliedMessage);
        return repliedMessage;
      },
      editReply: async (payload) => {
        const { content, embeds, files, components, flags } = typeof payload === "string" ? { content: payload } : payload;
        if (repliedMessage?.edit) {
          if (embeds || files || components) return repliedMessage.edit({ content, embeds, files, components, flags });
          return repliedMessage.edit(content);
        }
        if (embeds || files || components) repliedMessage = await sendPrefixResponse(message, { content, embeds, files, components, flags });
        else repliedMessage = await sendPrefixResponse(message, content);
        if (!keepMessages) scheduleDelete(repliedMessage);
        return repliedMessage;
      },
      deleteReply: async () => {
        if (repliedMessage?.delete) await repliedMessage.delete().catch(() => null);
      }
    };

    commandAccess.grantDelegatedPermissions(fakeInteraction);

    try {
      await require('../utils/tournamentScope').run(fakeInteraction, () => command.execute(fakeInteraction));
    } catch (err) {
      console.error('Error ejecutando comando por prefijo:', err);
      await sendPrefixResponse(message, err?.code === 'LEAGUE_SCOPE_DENIED' ? err.message : 'Error al ejecutar el comando.').catch(() => null);
    }
    });
  });
};
