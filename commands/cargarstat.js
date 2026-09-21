const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { readConfig } = require("../utils/database");
const officials = require("../utils/officials");
const statsStore = require("../utils/statsStore");
const roleRegistry = require("../utils/roleRegistry");
const divisions = require("../utils/divisions");
const haxoleSupabase = require("../utils/haxoleSupabase");

const parseRaw = (raw) => {
  const body = String(raw || "").trim().replace(/^\S+\s*/, "").trim();
  if (!body) return {};
  const named = (keys) => {
    for (const key of keys) {
      const match = body.match(new RegExp(`(?:^|[\\s,;])${key}\\s*[:=]\\s*([^,;]+(?:,[^,;]+)*)`, "i"));
      if (match) return match[1].trim();
    }
    return null;
  };
  const parts = body.split(/\s+/).filter(Boolean);
  const fechaToken = parts.find((part) => /^\d+$/.test(part)) || null;
  return {
    modalidad: named(["modalidad"]) || parts[0] || null,
    torneo: named(["torneo", "nombre"]) || parts.slice(1, fechaToken ? parts.indexOf(fechaToken) : parts.length).join(" ") || null,
    fecha: fechaToken ? Number(fechaToken) : null
  };
};

const extractFechaFromReport = (content) => {
  const text = String(content || "");
  const match = text.match(/(?:^|\n)\s*#?\s*FECHA\s*(\d+)\b/i) || text.match(/\bFECHA\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
};

const clubTokenPattern = /<a?:([a-zA-Z0-9_]+):(\d+)>|:([a-zA-Z0-9_]+):/g;
const clubPrefixPattern = /^(<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)/;
const parseEmojiToken = (raw) => {
  const value = String(raw || "").trim();
  const custom = value.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>$/);
  if (custom) return { name: custom[1], id: custom[2], full: custom[0] };
  const loose = value.match(/^:([a-zA-Z0-9_]+):$/);
  if (loose) return { name: loose[1], id: null, full: value };
  return null;
};

let cachedClubRows = [];

const hydrateClubCatalog = async () => {
  const cfg = readConfig();
  const configRows = Object.entries(cfg.clubs || {}).map(([clubName, club]) => ({
    nombre: clubName,
    emoji_id: club?.emoji_id || null,
    emoji_full: club?.emoji_full || club?.emoji || null,
    emoji_url: club?.emoji_url || null,
    source: "config",
    club
  }));
  const supabaseRows = haxoleSupabase.isEnabled
    ? await haxoleSupabase.listClubes().catch(() => [])
    : [];

  cachedClubRows = [
    ...Array.isArray(supabaseRows) ? supabaseRows.map((row) => ({ ...row, source: "supabase" })) : [],
    ...configRows
  ];

  return cachedClubRows;
};

const buildEmojiClubIndex = () => {
  const index = new Map();
  const put = (key, value, priority = 10) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    const current = index.get(normalizedKey);
    if (current && Number(current.priority) <= priority) return;
    index.set(normalizedKey, { ...value, priority });
  };

  const rows = Array.isArray(cachedClubRows) && cachedClubRows.length
    ? cachedClubRows
    : Object.entries(readConfig().clubs || {}).map(([clubName, club]) => ({
        nombre: clubName,
        emoji_id: club?.emoji_id || null,
        emoji_full: club?.emoji_full || club?.emoji || null,
        emoji_url: club?.emoji_url || null,
        source: "config",
        club
      }));
  for (const row of rows) {
    const clubName = String(row?.nombre || row?.name || "").trim();
    const club = row?.club || row || {};
    const raw = club?.emoji || club?.emoji_full || row?.emoji_full || null;
    const parsed = parseEmojiToken(raw);
    const normalizedName = normalizeLooseText(clubName);
    const normalizedAbbr = normalizeLooseText(club?.abbr || "");
    const priority = row?.source === "supabase" ? 1 : 2;
    const descriptor = { name: clubName, club, row };

    if (raw) put(String(raw).trim(), descriptor, priority);
    put(normalizedName, descriptor, priority);
    if (normalizedAbbr) put(normalizedAbbr, descriptor, priority);
    if (club?.emoji_id) put(String(club.emoji_id).trim(), descriptor, priority);
    if (club?.emoji_full) put(String(club.emoji_full).trim(), descriptor, priority);
    if (parsed) {
      put(parsed.full, descriptor, priority);
      put(parsed.id, descriptor, priority);
      put(parsed.name, descriptor, priority);
      put(`:${parsed.name}:`, descriptor, priority);
    }
  }
  return index;
};

const findClubByToken = (rawEmoji) => {
  const raw = String(rawEmoji || "").trim();
  const parsed = parseEmojiToken(raw);
  const index = buildEmojiClubIndex();
  return index.get(raw)
    || index.get(normalizeLooseText(raw))
    || (parsed ? index.get(parsed.full) || index.get(parsed.id) || index.get(parsed.name) || index.get(`:${parsed.name}:`) : null)
    || null;
};

const normalizeLooseText = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

const normalizeOwnGoalMarker = (value) => {
  const raw = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s._-]+/g, "");
  return /^(aug|ec|ge|gc|og|autogol|encontra|golencontra)$/.test(raw);
};

const extractStatToken = (segment, kind) => {
  const cleaned = String(segment || "")
    .replace(/\u00A0/g, " ")
    .replace(/\*\*/g, "")
    .replace(/[*_`]/g, "")
    .trim()
    .replace(/^[-â€“â€”]+\s*/, "")
    .replace(/\s*[-â€“â€”]+\s*$/, "")
    .trim();

  if (!cleaned || cleaned === "-") return null;

  const mentionMatch = cleaned.match(/(<@!?\d+>|\b\d{15,25}\b)/);
  const userId = mentionMatch ? mentionMatch[1].match(/\d{15,25}/)?.[0] || null : null;
  const countMatch = cleaned.match(/(?:^|\s)x\s*(\d+)\b/i) || cleaned.match(/\b(\d+)\s*x\b/i);
  const count = countMatch ? Number(countMatch[1]) || 0 : 1;
  const parentheticalContents = Array.from(cleaned.matchAll(/\(([^)]*)\)/g)).map((match) => match[1].trim()).filter(Boolean);
  const parenthetical = parentheticalContents.find(Boolean) || null;

  let base = cleaned
    .replace(mentionMatch?.[0] || "", "")
    .replace(/(?:^|\s)x\s*\d+\b/i, "")
    .replace(/\b\d+\s*x\b/i, "")
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base && parenthetical) {
    base = parenthetical.replace(/^(?:aug|og|ec|ge|gc)\b\s*/i, "").trim() || parenthetical;
  }

  const displayName = base
    .replace(/\b(?:aug|og|ec|ge|gc|a\/g)\b/gi, "")
    .replace(/\b\d+:\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim() || mentionMatch?.[0] || "Jugador";

  if (kind === "valla") {
    const timeMatch = cleaned.match(/(\d+:\d{2})/);
    return {
      userId,
      displayName,
      time: timeMatch ? timeMatch[1] : "14:00",
      marker: parenthetical ? parenthetical.split(/\s+/)[0] || parenthetical : null
    };
  }

  return {
    userId,
    displayName,
    count,
    marker: parenthetical ? parenthetical.split(/\s+/)[0] || parenthetical : (base.split(/\s+/)[0] || base)
  };
};

const parseStatToken = (segment, kind) => {
  const cleaned = String(segment || "")
    .trim()
    .replace(/^[-â€“â€”]+\s*/, "")
    .replace(/\s*[-â€“â€”]+\s*$/, "")
    .trim();

  if (!cleaned || cleaned === "-") return null;

  const mentionMatch = cleaned.match(/(<@!?\d+>|\b\d{15,25}\b)/);
  if (!mentionMatch) return null;

  const userId = mentionMatch[1].match(/\d{15,25}/)?.[0];
  if (!userId) return null;

  const countMatch = cleaned.match(/(?:^|\s)x\s*(\d+)\b/i) || cleaned.match(/\b(\d+)\s*x\b/i);
  const count = countMatch ? Number(countMatch[1]) || 0 : 1;
  const tail = cleaned
    .replace(mentionMatch[0], "")
    .replace(/(?:^|\s)x\s*\d+\b/i, "")
    .replace(/\b\d+\s*x\b/i, "")
    .replace(/[()"']/g, "")
    .trim();

  if (kind === "valla") {
    const timeMatch = tail.match(/(\d+:\d{2})/);
    return { userId, time: timeMatch ? timeMatch[1] : "14:00" };
  }

  return {
    userId,
    displayName: mentionMatch[0],
    count,
    marker: tail.split(/\s+/)[0] || tail
  };
};

const parseStatLine = (line) => {
  const scoreEmoji = line.match(clubPrefixPattern)?.[1] || null;
  if (!scoreEmoji) return null;

  const statMatch = line.match(/^(<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s*(g|a|v|goles|asistencias|valla(?:_invicta)?)\b\s*:?\s*(.*)$/i);
  if (!statMatch) return null;

  const rawType = String(statMatch[2] || "").toLowerCase().trim();
  const kind = rawType === "g" || rawType === "goles"
    ? "goles"
    : rawType === "a" || rawType === "asistencias"
      ? "asistencias"
      : "valla";

  const payload = String(statMatch[3] || "").trim();
  if (!payload || payload === "-") {
    return { emoji: scoreEmoji, kind, items: [] };
  }

  const parts = payload.split(/\s*(?:-\s*|,\s*)/).map((part) => part.trim()).filter(Boolean);
  const items = [];
  for (const part of parts) {
    const parsed = extractStatToken(part, kind);
    if (parsed) items.push(parsed);
  }
  return { emoji: scoreEmoji, kind, items };
};

const getOppositeClubInfo = (clubInfo, localClub, awayClub) => {
  const clubName = String(clubInfo?.name || "").trim();
  const localName = String(localClub?.name || "").trim();
  const awayName = String(awayClub?.name || "").trim();

  if (clubName && localName && clubName === localName) return awayClub || clubInfo;
  if (clubName && awayName && clubName === awayName) return localClub || clubInfo;
  return clubInfo;
};

const parseTimeToSeconds = (raw) => {
  const match = String(raw || "").trim().match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
};

const resolvePlayerIdentity = async (guild, playerName, clubName = null) => {
  const rawName = String(playerName || "").trim();
  const normalized = normalizeLooseText(rawName);
  const fallback = {
    userId: null,
    userTag: rawName || "Jugador",
    displayName: rawName || "Jugador"
  };

  if (!guild || !normalized) return fallback;

  const aliasHit = officials.findLinkedDiscordByPlayerName({ guildId: guild.id, playerName: rawName });
  if (aliasHit?.userId) {
    const member = await guild.members.fetch(aliasHit.userId).catch(() => null);
    if (member) {
      if (clubName) {
        officials.addPlayerAlias({
          guildId: guild.id,
          userId: member.id,
          playerName: rawName,
          source: "report"
        });
      }
      return {
        userId: member.id,
        userTag: member.user.tag,
        displayName: rawName || member.displayName || member.user.username || member.user.tag
      };
    }
  }

  await guild.members.fetch().catch(() => null);
  const member = guild.members.cache.find((m) => {
    const candidates = [m.displayName, m.nickname, m.user?.username, m.user?.globalName, m.user?.tag].filter(Boolean);
    return candidates.some((name) => normalizeLooseText(name) === normalized);
  }) || null;

  if (member) {
    if (clubName) {
      officials.addPlayerAlias({
        guildId: guild.id,
        userId: member.id,
        playerName: rawName,
        source: "report"
      });
    }
    return {
      userId: member.id,
      userTag: member.user.tag,
      displayName: rawName || member.displayName || member.user.username || member.user.tag
    };
  }

  return fallback;
};

const statIdentityCache = new Map();

const resolveStatIdentity = async (guild, stat, clubName, memberLookup = null) => {
  const cacheKey = `${guild?.id || ""}:${String(stat?.resolvedUserId || "").trim() || normalizeLooseText(stat?.playerName || "")}`;
  if (statIdentityCache.has(cacheKey)) return statIdentityCache.get(cacheKey);

  const fallbackName = stat?.playerName || stat?.sourceName || "Jugador";
  if (!guild || !stat?.playerName) {
    const fallback = {
      playerId: null,
      userId: stat?.resolvedUserId || null,
      userTag: fallbackName,
      displayName: fallbackName
    };
    statIdentityCache.set(cacheKey, fallback);
    return fallback;
  }

  let member = null;
  const mentionIds = extractMentionIds(`${stat?.playerName || ""} ${stat?.sourceName || ""}`);

  if (stat?.resolvedUserId) {
    const resolvedUserId = String(stat.resolvedUserId);
    member = memberLookup?.get(resolvedUserId) || guild.members.cache.get(resolvedUserId) || null;
    if (!member) {
      member = await guild.members.fetch(resolvedUserId).catch(() => null);
    }
  }

  if (!member && mentionIds.length) {
    for (const mentionId of mentionIds) {
      member = memberLookup?.get(mentionId) || guild.members.cache.get(mentionId) || null;
      if (!member) {
        member = await guild.members.fetch(mentionId).catch(() => null);
      }
      if (member) break;
    }
  }

  if (!member) {
    const normalizedName = normalizeLooseText(stat.playerName);
    member = guild.members.cache.find((m) => {
      const candidates = [
        m.displayName,
        m.nickname,
        m.user?.globalName,
        m.user?.username,
        m.user?.tag
      ].filter(Boolean);
      return candidates.some((candidate) => normalizeLooseText(candidate) === normalizedName);
    }) || null;
  }

  const resolvedIdentity = await haxoleSupabase.upsertPlayerIdentity({
    guildId: guild.id,
    discordUserId: member?.id || stat?.resolvedUserId || null,
    discordUsername: member?.user?.tag || null,
    discordAvatarUrl: member?.user?.displayAvatarURL?.() || null,
    haxballName: member?.displayName || member?.user?.globalName || member?.user?.username || fallbackName,
    clubName,
    source: "report"
  }).catch(() => ({ player: null, alias: null }));

  const storedDiscordUserId = String(resolvedIdentity.player?.discord_user_id || "").trim() || null;
  if (!member && storedDiscordUserId) {
    member = memberLookup?.get(storedDiscordUserId) || guild.members.cache.get(storedDiscordUserId) || null;
    if (!member) {
      member = await guild.members.fetch(storedDiscordUserId).catch(() => null);
    }
  }

  if (member) {
    if (clubName) {
      officials.addPlayerAlias({
        guildId: guild.id,
        userId: member.id,
        playerName: stat.playerName,
        source: "report"
      });
    }
  }

  const resolvedUserId = member?.id || storedDiscordUserId || stat?.resolvedUserId || null;
  const warnings = [];
  if (!resolvedUserId) {
    warnings.push(`Sin Discord vinculado para **${fallbackName}**.`);
  } else if (!member) {
    warnings.push(`**${fallbackName}** tiene Discord vinculado pero el usuario no figura en este servidor.`);
  }

  const resolved = {
    playerId: resolvedIdentity.player?.id || null,
    userId: resolvedUserId,
    userTag: member?.user?.tag || resolvedIdentity.player?.discord_username || fallbackName,
    displayName: resolvedIdentity.player?.display_name || member?.displayName || member?.user?.globalName || member?.user?.username || fallbackName
  };
  if (warnings.length) resolved.warnings = warnings;
  statIdentityCache.set(cacheKey, resolved);
  return resolved;
};

const extractRecUrl = (content) => {
  const text = String(content || "");
  const line = text.split(/\r?\n/).find((entry) => /^\s*rec\s*:/i.test(entry));
  if (!line) return null;
  const urlMatch = line.match(/https?:\/\/\S+/i);
  return urlMatch ? urlMatch[0].replace(/[)\].,;]+$/g, "") : null;
};

const prepareReportLines = (content) => {
  const text = String(content || "")
    .replace(/\u00A0/g, " ")
    .replace(/[â€“â€”]/g, "-")
    .trim();

  if (!text) return [];

  const scoreMatch = text.match(
    /^\s*(<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s*\d+\s*-\s*\d+\s*(<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)/
  );

  const lines = [];
  let remainder = text;

  if (scoreMatch) {
    const scoreLine = text.slice(0, scoreMatch[0].length).trim();
    lines.push(scoreLine);
    remainder = text.slice(scoreMatch[0].length).trim();
  }

  if (!remainder) return lines;

  const normalizedRemainder = remainder
    .replace(/(?=(?:<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s*(?:g|a|v|goles|asistencias|valla|figura|mvp|dest))/gi, "\n")
    .replace(/(?=\b(?:figura|destacados?)\s*:)/gi, "\n");

  for (const rawLine of normalizedRemainder.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line) lines.push(line);
  }

  return lines;
};

const splitClubSegments = (line) => {
  const text = String(line || "").replace(/\u00A0/g, " ").replace(/[â€“â€”]/g, "-").trim();
  if (!text) return [];

  const matches = Array.from(text.matchAll(clubTokenPattern));
  if (!matches.length) return [{ clubToken: null, text }];

  const segments = [];
  let cursor = 0;
  let currentClub = null;

  for (const match of matches) {
    const token = match[0];
    const index = typeof match.index === "number" ? match.index : 0;
    if (currentClub !== null) {
      segments.push({
        clubToken: currentClub,
        text: text.slice(cursor, index).trim()
      });
    }
    currentClub = token;
    cursor = index + token.length;
  }

  if (currentClub !== null) {
    segments.push({
      clubToken: currentClub,
      text: text.slice(cursor).trim()
    });
  }

  return segments.filter((segment) => segment.clubToken || segment.text);
};

const extractMentionIds = (text) => Array.from(String(text || "").matchAll(/<@!?(\d{15,25})>|\b(\d{15,25})\b/g))
  .map((match) => match[1] || match[2])
  .filter(Boolean);

const buildClubDescriptor = (token) => {
  const raw = String(token || "").trim();
  const found = raw ? findClubByToken(raw) : null;
  return {
    raw,
    name: found?.name || null,
    club: found?.club || null,
    row: found?.row || null
  };
};

const createStatRow = (clubInfo, userId, displayName) => ({
  clubName: clubInfo.name,
  clubEmoji: clubInfo.club?.emoji || clubInfo.club?.emoji_full || clubInfo.club?.emoji_id || clubInfo.row?.emoji_full || null,
  playerName: displayName || (userId ? `<@${userId}>` : "Jugador"),
  sourceName: displayName || (userId ? `<@${userId}>` : "Jugador"),
  resolvedUserId: userId || null,
  goles: 0,
  asistencias: 0,
  valla_invicta_segundos: 0,
  goles_contra: 0,
  es_mvp: false,
  es_destacado: false
});

const parseReportCore = (content) => {
  const lines = prepareReportLines(content);

  const scoreLine = lines.find((line) => /\d+\s*-\s*\d+/.test(line) && Array.from(line.matchAll(clubTokenPattern)).length >= 2)
    || lines.find((line) => /\d+\s*-\s*\d+/.test(line) && Array.from(line.matchAll(clubTokenPattern)).length >= 1)
    || lines.find((line) => /\d+\s*-\s*\d+/.test(line))
    || null;
  if (!scoreLine) return null;

  const scoreMatch = scoreLine.match(/(\d+)\s*-\s*(\d+)/);
  if (!scoreMatch) return null;

  const emojis = Array.from(scoreLine.matchAll(clubTokenPattern)).map((match) => match[0]);
  const localEmoji = emojis[0] || null;
  const awayEmoji = emojis[1] || null;
  const localClub = buildClubDescriptor(localEmoji);
  const awayClub = buildClubDescriptor(awayEmoji);

  const recUrl = extractRecUrl(content);
  const statBlocks = new Map();
  const userToClub = new Map();
  const mvpIds = new Set();
  const destIds = new Set();
  const mvpNames = new Set();
  const destNames = new Set();

  const upsertRow = (clubInfo, userId, displayName) => {
    if (!clubInfo || !userId) return null;
    const key = `${clubInfo.name}:${userId}`;
    const current = statBlocks.get(key) || createStatRow(clubInfo, userId, displayName);
    current.resolvedUserId = current.resolvedUserId || userId;
    if (displayName && (!current.playerName || /^<@!?\d+>$/.test(current.playerName))) {
      current.playerName = displayName;
      current.sourceName = displayName;
    }
    statBlocks.set(key, current);
    userToClub.set(userId, clubInfo);
    return current;
  };

  const markUsers = (ids, targetSet, rawText, clubInfo = null) => {
    if (ids.length) {
      for (const id of ids) {
        targetSet.add(id);
        const resolvedClub = clubInfo || userToClub.get(id) || null;
        if (resolvedClub) upsertRow(resolvedClub, id, `<@${id}>`);
      }
      return;
    }

    const names = String(rawText || "")
      .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, " ")
      .split(/(?:\s*-\s*|\s{2,}|,\s*)/g)
      .map((name) => name.trim())
      .filter(Boolean);
    for (const name of names) targetSet.add(name);
  };

  for (const line of lines) {
    const segments = splitClubSegments(line);
    for (const segment of segments) {
      const combined = segment.clubToken ? `${segment.clubToken} ${segment.text}`.trim() : segment.text;
      const clubInfo = segment.clubToken ? findClubByToken(segment.clubToken) : null;
      if (!clubInfo) continue;

      const parsedLine = parseStatLine(combined);
      if (parsedLine) {
        for (const item of parsedLine.items) {
          const isOwnGoal = parsedLine.kind === "goles" && normalizeOwnGoalMarker(item.marker);
          const statClubInfo = isOwnGoal ? getOppositeClubInfo(clubInfo, localClub, awayClub) : clubInfo;
          const row = upsertRow(statClubInfo, item.userId, item.displayName || (item.userId ? `<@${item.userId}>` : "Jugador"));
          if (!row) continue;

          if (parsedLine.kind === "valla") {
            const seconds = parseTimeToSeconds(item.time);
            if (seconds !== null) row.valla_invicta_segundos += seconds;
          } else if (parsedLine.kind === "goles") {
            if (isOwnGoal) row.goles_contra += item.count;
            else row.goles += item.count;
          } else if (parsedLine.kind === "asistencias") {
            row.asistencias += item.count;
          }
        }
        continue;
      }

      const rosterMatch = combined.match(/^(<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s+(.+)$/i);
      if (rosterMatch && /<@!?\d+>|\b\d{15,25}\b/.test(rosterMatch[2])) {
        for (const userId of extractMentionIds(rosterMatch[2])) {
          upsertRow(clubInfo, userId, `<@${userId}>`);
        }
        continue;
      }
    }

    const mvpMatch = line.match(/^(?:mvp|figura)\s*:\s*(.+)$/i);
    if (mvpMatch) {
      const ids = extractMentionIds(mvpMatch[1]);
      markUsers(ids, mvpIds, mvpMatch[1]);
      continue;
    }

    const destMatch = line.match(/^(?:dest|destacados?)\s*:\s*(.+)$/i);
    if (destMatch) {
      const ids = extractMentionIds(destMatch[1]);
      markUsers(ids, destIds, destMatch[1]);
    }
  }

  for (const id of mvpIds) {
    const clubInfo = userToClub.get(id);
    if (!clubInfo) continue;
    const row = statBlocks.get(`${clubInfo.name}:${id}`);
    if (row) row.es_mvp = true;
  }

  for (const id of destIds) {
    const clubInfo = userToClub.get(id);
    if (!clubInfo) continue;
    const row = statBlocks.get(`${clubInfo.name}:${id}`);
    if (row) row.es_destacado = true;
  }

  const playerRows = Array.from(statBlocks.values());
  const markRowsByName = (nameSet, flagKey) => {
    if (!nameSet?.size) return;
    for (const rawName of nameSet) {
      const normalized = normalizeLooseText(rawName);
      if (!normalized) continue;
      for (const row of playerRows) {
        const candidates = [row.playerName, row.sourceName].filter(Boolean);
        if (candidates.some((candidate) => normalizeLooseText(candidate) === normalized)) {
          row[flagKey] = true;
        }
      }
    }
  };

  markRowsByName(mvpNames, "es_mvp");
  markRowsByName(destNames, "es_destacado");

  return {
    score: {
      local: Number(scoreMatch[1]),
      away: Number(scoreMatch[2])
    },
    localClub,
    awayClub,
    stats: playerRows,
    recUrl
  };
};

const parseReportContent = (content) => {
  const guildId = require("../utils/database").getActiveGuildId();
  const aliases = officials.readStore().playerAliasesByGuild?.[guildId] || {};
  return require("../utils/reportParser").parseReport(content, buildClubDescriptor, (name) => {
    const ids = Object.entries(aliases).filter(([, bucket]) => (bucket.aliases || []).some((alias) => normalizeLooseText(alias.name) === normalizeLooseText(name))).map(([id]) => id);
    return ids.length === 1 ? ids[0] : null;
  });
};
const parseReportFlexible = (content) => parseReportCore(content);
const parseReport = (content) => parseReportCore(content);

const resolveLinkedReport = async (interaction) => {
  const getOptionString = (...names) => {
    for (const name of names) {
      try {
        const value = interaction.options.getString(name);
        if (value) return value;
      } catch {
        // Ignore missing option names from older slash registrations.
      }
    }
    return null;
  };

  const direct = getOptionString("reporte", "informe");
  if (direct) return direct;

  const refId = interaction.sourceMessage?.reference?.messageId || interaction.sourceMessage?.reference?.message_id || null;
  if (refId) {
    const referenced = await interaction.channel.messages.fetch(refId).catch(() => null);
    if (referenced?.content) return referenced.content;
  }

  const sourceContent = String(interaction.sourceMessage?.content || "").trim();
  if (sourceContent) {
    const sourceLines = sourceContent
      .replace(/\u00A0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const hasScore = sourceLines.some((line) => /\d+\s*-\s*\d+/.test(line));
    const hasClubs = sourceLines.some((line) => Array.from(line.matchAll(clubTokenPattern)).length >= 2);
    const hasStats = sourceLines.some((line) => /^(?:<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s*(?:g|a|v|goles|asistencias|valla|figura|mvp|dest)/i.test(line));
    if (hasScore && (hasClubs || hasStats)) return sourceContent;
  }

  const recent = await interaction.channel.messages.fetch({ limit: 15 }).catch(() => null);
  if (!recent) return null;

  const commandMessageId = interaction.sourceMessage?.id || interaction.id || null;
  const candidates = Array.from(recent.values())
    .filter((message) => message?.content && message.id !== commandMessageId && !message.author?.bot)
    .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

  const reportLike = candidates.find((message) => {
    const lines = String(message.content || "")
      .replace(/\u00A0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const hasScore = lines.some((line) => /\d+\s*-\s*\d+/.test(line));
    const hasClubs = lines.some((line) => Array.from(line.matchAll(clubTokenPattern)).length >= 2);
    const hasStats = lines.some((line) => /^(?:<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s*(?:g|a|v|goles|asistencias|valla|figura|mvp|dest)/i.test(line));
    return hasScore && (hasClubs || hasStats);
  });

  return reportLike?.content || null;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cargarstat")
    .setDescription("Carga un informe oficial y actualiza el partido del fixture")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(false))
    .addStringOption((o) => o.setName("torneo").setDescription("Nombre del torneo").setRequired(false))
    .addIntegerOption((o) => o.setName("fecha").setDescription("Numero de fecha").setRequired(false))
    .addStringOption((o) => o.setName("reporte").setDescription("Texto completo del informe").setRequired(false)),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 }).catch(() => null);
    }

    await hydrateClubCatalog().catch(() => null);

    const parsed = parseRaw(interaction.sourceMessage?.content || "");
    const linkedTournament = await haxoleSupabase.getTournamentByForumChannel(interaction.channel.id);
    const linkedModality = linkedTournament?.modalidad_id
      ? (await haxoleSupabase.getModalidadById(linkedTournament.modalidad_id))?.nombre || null
      : null;
    const modalidad = roleRegistry.normalizeModality(interaction.options.getString("modalidad") || parsed.modalidad || linkedModality || null);
    const torneoName = interaction.options.getString("torneo") || parsed.torneo || linkedTournament?.nombre || null;
    const reportContent = await resolveLinkedReport(interaction);

    if (!modalidad || !torneoName) {
      return interaction.reply({
        content: "No pude determinar la modalidad o el torneo. UsÃ¡ `/vincularinformes` o pasalos en el comando.",
        flags: 64
      });
    }

    if (!reportContent) {
      return interaction.reply({
        content: "No encontrÃ© el mensaje del informe. UsÃ¡ este comando respondiendo al informe o pegÃ¡ el texto en `reporte`.",
        flags: 64
      });
    }

    const parsedReport = parseReportContent(reportContent) || parseReportFlexible(reportContent) || parseReport(reportContent);
    if (!parsedReport || parsedReport.valid === false) {
      return interaction.reply({
        content: "No pude leer la plantilla del informe. RevisÃ¡ que tenga la linea del resultado y los bloques de goles/asistencias.",
        flags: 64
      });
    }

    const torneo = await haxoleSupabase.getTournament({ modality: modalidad, name: torneoName });
    if (!torneo) {
      return interaction.reply({
        content: `No encontre el torneo **${torneoName}** en **${modalidad}**.`,
        flags: 64
      });
    }

const ensureClubRowFromParsed = async (clubInfo) => {
      const resolved = clubInfo?.name ? clubInfo : (clubInfo?.raw ? buildClubDescriptor(clubInfo.raw) : null);
      if (!resolved?.name) return null;
      if (resolved.club?.id) return resolved.club;
      return haxoleSupabase.ensureClubRow(resolved.name, {
        emoji: resolved.club?.emoji_full || resolved.club?.emoji || resolved.club?.emoji_id || resolved.row?.emoji_full || resolved.raw || null
      }).catch(() => null);
    };

    const localClubRow = await ensureClubRowFromParsed(parsedReport.localClub);
    const awayClubRow = await ensureClubRowFromParsed(parsedReport.awayClub);
    if (!localClubRow?.id || !awayClubRow?.id) {
      return interaction.reply({
        content: `No pude resolver los clubes del informe: **${parsedReport.localClub.name || parsedReport.localClub.raw || "club A"}** / **${parsedReport.awayClub.name || parsedReport.awayClub.raw || "club B"}**.`,
        flags: 64
      });
    }

    const existingMatch = await haxoleSupabase.getMatchForFixture({
      torneoId: torneo.id,
      localClubId: localClubRow.id,
      awayClubId: awayClubRow.id,
      fecha: interaction.options.getInteger("fecha") || parsedReport.fecha || null
    });

    if (!existingMatch) {
      return interaction.reply({
        content: `No encontré un partido entre **${parsedReport.localClub.name || parsedReport.localClub.raw || "club A"}** y **${parsedReport.awayClub.name || parsedReport.awayClub.raw || "club B"}** para esta modalidad/torneo.`,
        flags: 64
      });
    }

    const partido = existingMatch;

    if (!partido) {
      return interaction.reply({
        content: "No pude guardar el partido en Supabase.",
        flags: 64
      });
    }

    const statsRows = [];
    const statsEntries = [];
    const warnings = [];
    const matchFecha = Number(partido.fecha) || Number(existingMatch.fecha) || null;
    const localDivision = divisions.getClubDivision(readConfig(), parsedReport.localClub.name, modalidad) || "sin-division";
    const awayDivision = divisions.getClubDivision(readConfig(), parsedReport.awayClub.name, modalidad) || "sin-division";
    const reportUserIds = Array.from(new Set(
      parsedReport.stats
        .map((stat) => String(stat.resolvedUserId || "").trim())
        .filter(Boolean)
    ));
    const reportMemberLookup = new Map();
    await Promise.all(reportUserIds.map(async (userId) => {
      const member = interaction.guild.members.cache.get(userId)
        || await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) reportMemberLookup.set(userId, member);
    }));

    for (const stat of parsedReport.stats) {
      const statClubRow = stat.clubName === parsedReport.localClub.name
        ? localClubRow
        : stat.clubName === parsedReport.awayClub.name
          ? awayClubRow
          : await haxoleSupabase.ensureClubRow(stat.clubName, { emoji: stat.clubEmoji || null }).catch(() => null);
      if (!statClubRow?.id) continue;

      const identity = await resolveStatIdentity(interaction.guild, stat, stat.clubName, reportMemberLookup);
      if (Array.isArray(identity.warnings) && identity.warnings.length) {
        warnings.push(...identity.warnings.map((warning) => `• ${stat.playerName}: ${warning}`));
      }

      const playerRow = {
        partido_id: partido.id,
        club_id: statClubRow.id,
        jugador_id: identity.playerId || null,
        jugador_nombre: identity.displayName || stat.playerName,
        goles: Number(stat.goles) || 0,
        asistencias: Number(stat.asistencias) || 0,
        valla_invicta_segundos: Number(stat.valla_invicta_segundos) || 0,
        goles_contra: Number(stat.goles_contra) || 0,
        es_mvp: Boolean(stat.es_mvp),
        es_destacado: Boolean(stat.es_destacado)
      };
      statsRows.push(playerRow);

      if (playerRow.goles > 0) {
        statsEntries.push({
          partidoId: partido.id,
          matchKey: partido.id,
          seasonId: null,
          seasonName: null,
          modality: modalidad,
          division: null,
          fecha: matchFecha,
          playerId: identity.playerId || null,
          discordUserId: identity.userId || null,
          userId: identity.playerId || identity.userId || `${stat.clubName}:${stat.playerName}`,
          userTag: identity.userTag || stat.playerName,
          displayName: identity.displayName || stat.playerName,
          clubName: stat.clubName,
          clubEmoji: stat.clubEmoji || null,
          statType: "goles",
          value: playerRow.goles,
          division: stat.clubName === parsedReport.localClub.name ? localDivision : stat.clubName === parsedReport.awayClub.name ? awayDivision : "sin-division",
          createdBy: interaction.user.tag,
          warnings: []
        });
      }
      if (playerRow.goles_contra > 0) {
        statsEntries.push({
          partidoId: partido.id,
          matchKey: partido.id,
          seasonId: null,
          seasonName: null,
          modality: modalidad,
          division: null,
          fecha: matchFecha,
          playerId: identity.playerId || null,
          discordUserId: identity.userId || null,
          userId: identity.playerId || identity.userId || `${stat.clubName}:${stat.playerName}`,
          userTag: identity.userTag || stat.playerName,
          displayName: identity.displayName || stat.playerName,
          clubName: stat.clubName,
          clubEmoji: stat.clubEmoji || null,
          statType: "goles_contra",
          value: playerRow.goles_contra,
          division: stat.clubName === parsedReport.localClub.name ? localDivision : stat.clubName === parsedReport.awayClub.name ? awayDivision : "sin-division",
          createdBy: interaction.user.tag,
          warnings: []
        });
      }
      if (playerRow.asistencias > 0) {
        statsEntries.push({
          partidoId: partido.id,
          matchKey: partido.id,
          seasonId: null,
          seasonName: null,
          modality: modalidad,
          division: null,
          fecha: matchFecha,
          playerId: identity.playerId || null,
          discordUserId: identity.userId || null,
          userId: identity.playerId || identity.userId || `${stat.clubName}:${stat.playerName}`,
          userTag: identity.userTag || stat.playerName,
          displayName: identity.displayName || stat.playerName,
          clubName: stat.clubName,
          clubEmoji: stat.clubEmoji || null,
          statType: "asistencias",
          value: playerRow.asistencias,
          division: stat.clubName === parsedReport.localClub.name ? localDivision : stat.clubName === parsedReport.awayClub.name ? awayDivision : "sin-division",
          createdBy: interaction.user.tag,
          warnings: []
        });
      }
      if (playerRow.valla_invicta_segundos > 0) {
        statsEntries.push({
          partidoId: partido.id,
          matchKey: partido.id,
          seasonId: null,
          seasonName: null,
          modality: modalidad,
          division: null,
          fecha: matchFecha,
          playerId: identity.playerId || null,
          discordUserId: identity.userId || null,
          userId: identity.playerId || identity.userId || `${stat.clubName}:${stat.playerName}`,
          userTag: identity.userTag || stat.playerName,
          displayName: identity.displayName || stat.playerName,
          clubName: stat.clubName,
          clubEmoji: stat.clubEmoji || null,
          statType: "valla_invicta",
          value: playerRow.valla_invicta_segundos,
          division: stat.clubName === parsedReport.localClub.name ? localDivision : stat.clubName === parsedReport.awayClub.name ? awayDivision : "sin-division",
          createdBy: interaction.user.tag,
          warnings: []
        });
      }
    }

    {
      const reversed = String(partido.club_local_id) !== String(localClubRow.id);
      const publication = await haxoleSupabase.request("rpc/publish_approved_report", {
        method: "POST",
        body: { p_match_id: partido.id, p_home: reversed ? parsedReport.score.away : parsedReport.score.local,
          p_away: reversed ? parsedReport.score.local : parsedReport.score.away,
          p_report: reportContent, p_replay: parsedReport.recUrl || null, p_stats: statsRows }
      });
      if (!publication.ok) {
        console.error("[cargarstat] Publicación fallida:", publication.error);
        throw new Error("No se publicó el informe. Verificá la migración 202609090002_atomic_reports.sql y la conexión a Supabase.");
      }
    }

    {
      statsStore.replaceEntriesForMatch({
        partidoId: partido.id,
        modality: modalidad,
        fecha: matchFecha,
        clubNames: [parsedReport.localClub.name, parsedReport.awayClub.name],
        entries: statsEntries
      });
      await haxoleSupabase.syncPlayerTiersForModality(modalidad).catch((error) => {
        console.error("[cargarstat] Error sincronizando tiers:", error);
      });
    }

    const goalsRegistered = statsRows.reduce((total, row) => total + (Number(row.goles) || 0) + (Number(row.goles_contra) || 0), 0);
    const assistsRegistered = statsRows.reduce((total, row) => total + (Number(row.asistencias) || 0), 0);
    const cleanSheets = statsRows.filter((row) => Number(row.valla_invicta_segundos) > 0).length;
    const mvpCount = statsRows.filter((row) => Boolean(row.es_mvp)).length;
    const destCount = statsRows.filter((row) => Boolean(row.es_destacado)).length;
    const uniqueWarnings = Array.from(new Set(warnings));

      await interaction.reply({
        content: [
          "✅ Informe cargado correctamente",
          "",
          `Torneo: **${torneo.nombre}**`,
          `Modalidad: **${modalidad}**`,
          `Fecha: **${matchFecha ?? partido.fecha ?? "?"}**`,
        `Partido: **${(parsedReport.localClub.name || parsedReport.localClub.raw || "Local")} ${parsedReport.score.local} - ${parsedReport.score.away} ${(parsedReport.awayClub.name || parsedReport.awayClub.raw || "Visitante")}**`,
        "",
        `👥 Jugadores: **${statsRows.length}**`,
        `⚽ Goles registrados: **${goalsRegistered}**`,
        `🅰️ Asistencias registradas: **${assistsRegistered}**`,
        `🧤 Vallas invictas: **${cleanSheets}**`,
        `⭐ MVP: **${mvpCount}**`,
        `🔥 Destacados: **${destCount}**`,
        uniqueWarnings.length ? "" : null,
        uniqueWarnings.length ? `⚠️ Advertencias:\n${uniqueWarnings.join("\n")}` : null,
        "",
        "✅ Estadísticas guardadas en Supabase"
      ].join("\n"),
      flags: 64
    });
    return { reportSaved: true, partidoId: partido.id };
  }
};

module.exports.previewReport = async (raw, guildId) => require("../utils/database").withGuild(guildId, async () => {
  await hydrateClubCatalog();
  const parsed = parseReportContent(raw);
  if (!parsed) return null;
  return { ...parsed, description: require("../utils/reportPreview").reportPreview(parsed) };
});



