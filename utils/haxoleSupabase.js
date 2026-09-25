const statsStore = require("./statsStore");
const supabaseState = require("./supabaseState");
const clubsUtil = require("./clubs");
const roleRegistry = require("./roleRegistry");
const tournamentScope = require('./tournamentScope');

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/g, "");
const SUPABASE_SERVICE_KEY = String(
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  ""
).trim();

const isEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

let warnedMissingConfig = false;
const warnIfDisabled = () => {
  if (isEnabled || warnedMissingConfig) return;
  warnedMissingConfig = true;
  console.warn("[haxoleSupabase] Integracion desactivada: faltan SUPABASE_URL o SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.");
};

const headers = () => ({
  apikey: SUPABASE_SERVICE_KEY,
  ...(!SUPABASE_SERVICE_KEY.startsWith('sb_secret_') ? { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } : {}),
  "Content-Type": "application/json",
  Prefer: "return=representation"
});

const buildUrl = (path, params = {}) => {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
};

const transport = async (path, { method = "GET", params = {}, body = null, prefer = "return=representation" } = {}) => {
  if (!isEnabled) {
    warnIfDisabled();
    return { ok: false, skipped: true, data: null, error: "supabase-disabled" };
  }

  const reqHeaders = headers();
  if (prefer) reqHeaders.Prefer = prefer;

  const response = await fetch(buildUrl(path, params), {
    method,
    headers: reqHeaders,
    body: body === null ? null : JSON.stringify(body)
  }).catch((error) => ({ ok: false, status: 0, text: async () => String(error?.message || error) }));

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, status: response.status || 0, error: text || `HTTP ${response.status || 0}` };
  }

  if (response.status === 204) return { ok: true, data: null };

  const text = await response.text().catch(() => "");
  if (!text) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
};

const request = async (path, options = {}) => {
  if (!isEnabled) return transport(path, options);
  return transport(path, await require('./leagueRequestGuard').guard(path, options, transport));
};

const selectRows = async (table, params = {}) => request(table, {
  method: "GET",
  params: { select: "*", ...params },
  prefer: "return=minimal"
});

const insertRows = async (table, rows) => request(table, {
  method: "POST",
  body: rows,
  prefer: "return=representation"
});

const upsertRows = async (table, rows, onConflict) => request(table, {
  method: "POST",
  params: onConflict ? { on_conflict: onConflict } : {},
  body: rows,
  prefer: "resolution=merge-duplicates,return=representation"
});

const patchRows = async (table, params, body) => request(table, {
  method: "PATCH",
  params,
  body,
  prefer: "return=representation"
});

const deleteRows = async (table, params = {}) => request(table, {
  method: "DELETE",
  params,
  prefer: "return=minimal"
});

const parseCustomEmoji = (raw) => {
  const value = String(raw || "").trim();
  const custom = value.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>$/);
  if (!custom) return { emoji_id: null, emoji_full: value || null, emoji_url: null };
  const [, name, id] = custom;
  return {
    emoji_id: id,
    emoji_full: value,
    emoji_url: `https://cdn.discordapp.com/emojis/${id}.png?quality=lossless`,
    emoji_name: name
  };
};

const normalizeDivision = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (["1", "1ra", "primera", "primera division", "primera división"].includes(raw)) return "1ra";
  if (["2", "2da", "segunda", "segunda division", "segunda división"].includes(raw)) return "2da";
  return null;
};

const normalizePlayerAlias = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

const getPlayerById = async (playerId) => {
  const id = String(playerId || "").trim();
  if (!id) return null;
  const { ok, data } = await selectRows("jugadores", { id: `eq.${id}` });
  if (!ok) return null;
  return Array.isArray(data) ? data[0] || null : null;
};

const getPlayerByDiscord = async ({ guildId, discordUserId }) => {
  const cleanGuild = String(guildId || "").trim();
  const cleanUserId = String(discordUserId || "").trim();
  if (!cleanGuild || !cleanUserId) return null;
  const { ok, data } = await selectRows("jugadores", {
    discord_guild_id: `eq.${cleanGuild}`,
    discord_user_id: `eq.${cleanUserId}`
  });
  if (!ok) return null;
  return Array.isArray(data) ? data[0] || null : null;
};

const getPlayerByAlias = async ({ guildId, alias }) => {
  const cleanGuild = String(guildId || "").trim();
  const normalizedAlias = normalizePlayerAlias(alias);
  if (!cleanGuild || !normalizedAlias) return null;
  const { ok, data } = await selectRows("jugador_aliases", {
    discord_guild_id: `eq.${cleanGuild}`,
    normalized_alias: `eq.${normalizedAlias}`,
    select: "*, jugador:jugadores(*)"
  });
  if (!ok) return null;
  if (!Array.isArray(data) || !data.length) return null;
  const row = data[0];
  return row?.jugador || null;
};

const upsertPlayerIdentity = async ({
  guildId,
  discordUserId = undefined,
  discordUsername = undefined,
  discordAvatarUrl = undefined,
  haxballName,
  clubId = undefined,
  clubName = undefined,
  torneoId = undefined,
  modalidadId = undefined,
  modalidadName = undefined,
  clearCurrentClub = false,
  clearCurrentModality = false,
  source = "report"
} = {}) => {
  const cleanGuild = String(guildId || "").trim();
  const cleanDiscordUserId = String(discordUserId || "").trim() || null;
  const cleanDiscordUsername = String(discordUsername || "").trim() || null;
  const cleanDiscordAvatarUrl = String(discordAvatarUrl || "").trim() || null;
  const cleanName = String(haxballName || "").trim();
  const normalizedAlias = normalizePlayerAlias(cleanName);
  if (!cleanGuild || !cleanName || !normalizedAlias) {
    return { player: null, alias: null, created: false };
  }

  const now = new Date().toISOString();
  let player = cleanDiscordUserId
    ? await getPlayerByDiscord({ guildId: cleanGuild, discordUserId: cleanDiscordUserId })
    : null;

  if (!player) {
    const aliasMatch = await getPlayerByAlias({ guildId: cleanGuild, alias: cleanName });
    if (aliasMatch && (!cleanDiscordUserId || !aliasMatch.discord_user_id || aliasMatch.discord_user_id === cleanDiscordUserId)) player = aliasMatch;
  }

  const clubPayload = clearCurrentClub
    ? { current_club_id: null, current_club_name: null }
    : (clubId !== undefined || clubName !== undefined
      ? {
          current_club_id: clubId ?? null,
          current_club_name: clubName ?? null
        }
      : {});
  const modalityPayload = clearCurrentModality
    ? { current_modalidad_id: null, current_modalidad_name: null }
    : (modalidadId !== undefined || modalidadName !== undefined
      ? {
          current_modalidad_id: modalidadId ?? null,
          current_modalidad_name: modalidadName ?? null
        }
      : {});

  if (!player) {
    const inserted = await upsertRows("jugadores", [{
      discord_guild_id: cleanGuild,
      discord_user_id: cleanDiscordUserId,
      discord_username: cleanDiscordUsername,
      discord_avatar_url: cleanDiscordAvatarUrl,
      display_name: cleanName,
      first_haxball_name: cleanName,
      last_haxball_name: cleanName,
      first_detected_at: now,
      last_detected_at: now,
      updated_at: now,
      ...clubPayload,
      ...modalityPayload
    }], "discord_guild_id,discord_user_id");
    player = Array.isArray(inserted.data) ? inserted.data[0] || null : null;
  } else {
    const patch = {
      updated_at: now,
      last_detected_at: now,
      last_haxball_name: cleanName,
      display_name: cleanName,
      discord_username: cleanDiscordUsername || player.discord_username || null,
      discord_avatar_url: cleanDiscordAvatarUrl || player.discord_avatar_url || null,
      ...clubPayload,
      ...modalityPayload
    };
    if (cleanDiscordUserId && !player.discord_user_id) patch.discord_user_id = cleanDiscordUserId;
    if (!cleanDiscordUserId && player.discord_user_id) patch.discord_user_id = player.discord_user_id;
    const updated = await patchRows("jugadores", { id: `eq.${player.id}` }, patch);
    player = Array.isArray(updated.data) ? updated.data[0] || player : player;
  }

  if (!player?.id) return { player: null, alias: null, created: false };

  const aliasPayload = {
    jugador_id: player.id,
    discord_guild_id: cleanGuild,
    alias: cleanName,
    normalized_alias: normalizedAlias,
    last_seen_at: now,
    source,
    updated_at: now
  };
  if (clubId || clubName) {
    aliasPayload.last_club_id = clubId || null;
    aliasPayload.last_club_name = clubName || null;
    if (!player.current_club_id && clubId) aliasPayload.first_club_id = clubId;
    if (!player.current_club_name && clubName) aliasPayload.first_club_name = clubName;
  }
  if (torneoId) {
    aliasPayload.last_torneo_id = torneoId;
    if (!player.first_torneo_id) aliasPayload.first_torneo_id = torneoId;
  }
  if (modalidadId) {
    aliasPayload.last_modalidad_id = modalidadId;
    if (!player.first_modalidad_id) aliasPayload.first_modalidad_id = modalidadId;
  }
  if (modalidadName) {
    aliasPayload.last_modalidad_name = modalidadName;
    if (!player.first_modalidad_name) aliasPayload.first_modalidad_name = modalidadName;
  }

  const existingAliasResult = await selectRows("jugador_aliases", {
    discord_guild_id: `eq.${cleanGuild}`,
    normalized_alias: `eq.${normalizedAlias}`
  });
  const existingAlias = Array.isArray(existingAliasResult.data) ? existingAliasResult.data[0] || null : null;

  let alias = null;
  if (existingAlias?.id) {
    const updatedAlias = await patchRows("jugador_aliases", { id: `eq.${existingAlias.id}` }, {
      ...aliasPayload,
      first_seen_at: existingAlias.first_seen_at || now,
      seen_count: (Number(existingAlias.seen_count) || 0) + 1
    });
    alias = Array.isArray(updatedAlias.data) ? updatedAlias.data[0] || existingAlias : existingAlias;
  } else {
    const insertedAlias = await insertRows("jugador_aliases", [{
      ...aliasPayload,
      first_seen_at: now,
      seen_count: 1
    }]);
    alias = Array.isArray(insertedAlias.data) ? insertedAlias.data[0] || null : null;
  }

  return { player, alias, created: !player?.created_at || String(player.created_at) === now };
};

const getModalidadRow = async (modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  const { ok, data } = await selectRows("modalidades", { nombre: `eq.${mod}` });
  if (!ok) return null;
  return Array.isArray(data) ? data[0] || null : null;
};

const getModalidadById = async (modalityId) => {
  const id = String(modalityId || "").trim();
  if (!id) return null;
  const { ok, data } = await selectRows("modalidades", { id: `eq.${id}` });
  if (!ok) return null;
  return Array.isArray(data) ? data[0] || null : null;
};

const ensureModalidad = async (modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return null;
  const existing = await getModalidadRow(mod);
  if (existing) return existing;
  const inserted = await upsertRows("modalidades", [{ nombre: mod, descripcion: null }], "nombre");
  return Array.isArray(inserted.data) ? inserted.data[0] || null : null;
};

const getClubRowByName = async (clubName) => {
  const name = String(clubName || "").trim();
  if (!name) return null;
  const { ok, data } = await selectRows("clubes", { nombre: `eq.${name}` });
  if (!ok) return null;
  if (Array.isArray(data) && data.length) return data[0] || null;

  const normalizedTarget = normalizePlayerAlias(name);
  const fallback = await selectRows("clubes");
  if (!fallback.ok || !Array.isArray(fallback.data)) return null;
  return fallback.data.find((club) => normalizePlayerAlias(club?.nombre) === normalizedTarget) || null;
};

const ensureClubRow = async (clubName, data = {}) => {
  const name = String(clubName || "").trim();
  if (!name) return null;
  const emoji = parseCustomEmoji(data.emoji || data.emoji_full || data.emojiId || data.emoji_id || "");
  const modalidades = Array.isArray(data.modalidades)
    ? data.modalidades
    : Array.isArray(data.modalityList)
      ? data.modalityList
      : Array.isArray(data.modalities)
        ? data.modalities
        : [];
  const safeModalidades = modalidades
    .map((mod) => String(mod || "").trim())
    .filter(Boolean);
  const payload = {
    nombre: name,
    abreviacion: data.abbr || data.abreviacion || null,
    nombre_corto: data.shortName || data.nombre_corto || null,
    logo_url: data.logoUrl || data.logo_url || null,
    pack: data.pack || null,
    modalidades: safeModalidades,
    emoji_id: emoji.emoji_id,
    emoji_full: emoji.emoji_full,
    emoji_url: data.emoji_url || emoji.emoji_url || null,
    capitan: data.capitan || null
  };
  const legacyPayload = {
    nombre: payload.nombre,
    emoji_id: payload.emoji_id,
    emoji_full: payload.emoji_full,
    emoji_url: payload.emoji_url,
    capitan: payload.capitan
  };

  const existing = await getClubRowByName(name);
  if (existing?.id) {
    // Club identity is shared; league-local captains/roles stay in the guild bucket.
    if (tournamentScope.currentGuild() !== tournamentScope.TEST_GUILD) return existing;
    const updated = await patchRows("clubes", { id: `eq.${existing.id}` }, payload);
    if (updated.ok && Array.isArray(updated.data) && updated.data.length) return updated.data[0] || existing;

    const legacyUpdated = await patchRows("clubes", { id: `eq.${existing.id}` }, legacyPayload);
    if (legacyUpdated.ok && Array.isArray(legacyUpdated.data) && legacyUpdated.data.length) return legacyUpdated.data[0] || existing;
    return existing;
  }

  const insertCandidates = [
    payload,
    legacyPayload,
    { nombre: name }
  ];

  let lastError = null;
  for (const candidate of insertCandidates) {
    const inserted = await insertRows("clubes", [candidate]);
    if (inserted.ok && Array.isArray(inserted.data) && inserted.data.length) {
      return inserted.data[0] || null;
    }

    lastError = inserted.error || lastError;

    if (/duplicate key value|unique constraint|23505/i.test(String(inserted.error || ""))) {
      const refreshed = await getClubRowByName(name);
      if (refreshed?.id) return refreshed;
    }
  }

  const refreshed = await getClubRowByName(name);
  if (refreshed?.id) return refreshed;

  console.warn(
    "[haxoleSupabase] ensureClubRow fallo para",
    name,
    "payload:",
    JSON.stringify(payload),
    "legacy:",
    JSON.stringify(legacyPayload),
    "error:",
    lastError || "unknown"
  );
  return existing || null;
};

const formatValuationValue = (value) => {
  const safe = Number(value) || 0;
  return Math.max(0, Math.round(safe));
};

const getPlayerValuation = async (playerId) => {
  const id = String(playerId || "").trim();
  if (!id) return null;
  const { ok, data } = await selectRows("jugadores", { id: `eq.${id}` });
  if (!ok) return null;
  const row = Array.isArray(data) ? data[0] || null : null;
  if (!row) return null;
  return { ...row, valuacion: row.valuacion === null || row.valuacion === undefined ? null : Number(row.valuacion) };
};

const setPlayerValuation = async ({ playerId, valuation }) => {
  const id = String(playerId || "").trim();
  if (!id) return null;
  const safe = formatValuationValue(valuation);
  const updated = await patchRows("jugadores", { id: `eq.${id}` }, { valuacion: safe });
  if (!updated.ok) throw new Error(`No se pudo guardar la valuación: ${updated.error || updated.status}`);
  return Array.isArray(updated.data) ? updated.data[0] || null : null;
};

const ensureTournament = async ({ modality, name, cantidad_equipos = 12, modo_copa = false, tipo = "exclusivo" }) => {
  const modalidad = await ensureModalidad(modality);
  if (!modalidad) return null;

  const payload = {
    modalidad_id: modalidad.id,
    nombre: String(name || "").trim(),
    cantidad_equipos: Number(cantidad_equipos) || 12,
    modo_copa: Boolean(modo_copa),
    estado: "activo",
    tipo: String(tipo || "exclusivo").trim() || "exclusivo"
  };
  if (!payload.nombre) return null;

  const upserted = await upsertRows("torneos", [payload], "modalidad_id,tipo,nombre");
  return Array.isArray(upserted.data) ? upserted.data[0] || null : null;
};

const getTournament = async ({ modality, name, tipo = tournamentScope.currentLeague() }) => {
  const modalidad = await ensureModalidad(modality);
  if (!modalidad) return null;
  const torneoName = String(name || "").trim();
  if (!torneoName) return null;
  const { ok, data } = await selectRows("torneos", {
    modalidad_id: `eq.${modalidad.id}`,
    nombre: `eq.${torneoName}`,
    ...(tipo ? { tipo: `eq.${tipo}` } : {})
  });
  if (!ok) return null;
  if (Array.isArray(data) && data.length) return tournamentScope.unambiguous(data)[0] || null;

  const normalizedTarget = normalizePlayerAlias(torneoName);
  const fallback = await selectRows("torneos", { modalidad_id: `eq.${modalidad.id}`, ...(tipo ? { tipo: `eq.${tipo}` } : {}) });
  if (!fallback.ok || !Array.isArray(fallback.data)) return null;
  const candidates = fallback.data.filter((torneo) => normalizePlayerAlias(torneo?.nombre) === normalizedTarget);
  if (candidates.length > 1) throw new Error('El nombre del torneo es ambiguo. Usá su nombre exacto en el servidor de la liga.');
  return candidates[0] || null;
};

const inspectTournamentRemoval = async ({ modality, name }) => {
  const league = tournamentScope.currentLeague();
  if (!league) throw new Error("No se pudo identificar la liga. No se borró nada.");
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod || !String(name || "").trim()) return null;
  const modalityResult = await selectRows("modalidades", { nombre: `eq.${mod}` });
  if (!modalityResult.ok || !Array.isArray(modalityResult.data)) throw new Error("No pude verificar la modalidad. No se borró nada.");
  const modalityRow = modalityResult.data[0];
  if (!modalityRow) return null;
  const tournamentResult = await selectRows("torneos", { modalidad_id: `eq.${modalityRow.id}`, nombre: `eq.${String(name).trim()}`, tipo: `eq.${league}` });
  if (!tournamentResult.ok || !Array.isArray(tournamentResult.data)) throw new Error("No pude verificar el torneo. No se borró nada.");
  if (tournamentResult.data.length > 1) throw new Error("Hay más de un torneo con ese nombre en la liga. No se borró nada.");
  const torneo = tournamentResult.data[0];
  if (!torneo) return null;
  return { torneo };
};

const removeTournament = async ({ modality, name }) => {
  const inspected = await inspectTournamentRemoval({ modality, name });
  if (!inspected) return null;
  const removed = await request("rpc/bot_delete_tournament", { method: "POST", body: { p_id: inspected.torneo.id, p_expected_name: inspected.torneo.nombre, p_tipo: tournamentScope.currentLeague() } });
  if (!removed.ok) throw new Error(removed.status === 404 ? "Falta aplicar la migración de borrado de torneos en Supabase. No se borró nada." : `No se pudo borrar el torneo: ${removed.error || removed.status}`);
  if (removed.data !== true) throw new Error("El torneo cambió o ya no existe. No se borró nada.");
  const remaining = await selectRows("torneos", { id: `eq.${inspected.torneo.id}` });
  if (!remaining.ok || !Array.isArray(remaining.data) || remaining.data.length) throw new Error("No pude confirmar el borrado del torneo. Revisá Supabase antes de reintentar.");
  return inspected.torneo;
};

const updateTournament = async ({ modality, name, patch = {} }) => {
  const torneo = await getTournament({ modality, name });
  if (!torneo) return null;
  if (patch.estado === "finalizado") {
    const matches = [];
    for (let offset = 0; ; offset += 500) {
      const page = await selectRows("partidos", { torneo_id: `eq.${torneo.id}`, order: "id.asc", limit: 500, offset });
      if (!page.ok || !Array.isArray(page.data)) throw new Error("No pude verificar los partidos. El torneo no se finalizó.");
      matches.push(...page.data);
      if (page.data.length < 500) break;
    }
    require("./tournamentCompletion").assertTournamentComplete(torneo, matches);
  }
  const updated = await patchRows("torneos", { id: `eq.${torneo.id}` }, patch);
  return updated.ok && Array.isArray(updated.data) ? updated.data[0] || null : null;
};

const adjustTournamentSlots = async ({ modality, name, slots = 1 }) => {
  const torneo = await getTournament({ modality, name });
  if (!torneo) return null;

  const delta = Math.trunc(Number(slots) || 0);
  if (!delta) {
    return {
      ok: true,
      tournament: torneo,
      previousCapacity: Number(torneo.cantidad_equipos || 0),
      nextCapacity: Number(torneo.cantidad_equipos || 0),
      occupiedCount: 0,
      delta: 0
    };
  }

  const rows = await getTournamentClubRows(torneo.id);
  const occupiedCount = Array.isArray(rows) ? rows.length : 0;
  const previousCapacity = Number(torneo.cantidad_equipos || 0);
  const nextCapacity = previousCapacity + delta;

  if (nextCapacity < occupiedCount) {
    return {
      ok: false,
      reason: `No se pueden dejar ${nextCapacity} cupos porque hay ${occupiedCount} club(es) inscripto(s).`,
      tournament: torneo,
      previousCapacity,
      nextCapacity,
      occupiedCount,
      delta
    };
  }

  if (nextCapacity < 0) {
    return {
      ok: false,
      reason: "El total de cupos no puede ser negativo.",
      tournament: torneo,
      previousCapacity,
      nextCapacity,
      occupiedCount,
      delta
    };
  }

  const updated = await updateTournament({
    modality,
    name,
    patch: {
      cantidad_equipos: nextCapacity
    }
  });

  return {
    ok: Boolean(updated),
    tournament: updated || torneo,
    previousCapacity,
    nextCapacity,
    occupiedCount,
    delta
  };
};

const addTournamentSlots = async ({ modality, name, slots = 1 }) => {
  const result = await adjustTournamentSlots({ modality, name, slots });
  return result?.ok ? result.tournament : null;
};

const setTournamentForumLink = async ({ modality, name, channelId, messageId = null, guildId = null }) => {
  const torneo = await getTournament({ modality, name });
  if (!torneo) return null;
  const payload = {
    informe_canal_id: String(channelId || "").trim() || null,
    informe_mensaje_id: messageId ? String(messageId).trim() : null,
    informe_guild_id: guildId ? String(guildId).trim() : null
  };
  const updated = await patchRows("torneos", { id: `eq.${torneo.id}` }, payload);
  return Array.isArray(updated.data) ? updated.data[0] || null : null;
};

const getTournamentByForumChannel = async (channelId) => {
  const id = String(channelId || "").trim();
  if (!id) return null;
  const { ok, data } = await selectRows("torneos", { informe_canal_id: `eq.${id}` });
  if (!ok) return null;
  return Array.isArray(data) ? data[0] || null : null;
};

const getTournamentClubRows = async (torneoId) => {
  const { ok, data } = await selectRows("torneo_clubes", {
    torneo_id: `eq.${torneoId}`,
    select: "id, torneo_id, club_id, posicion, created_at, club:clubes(*)"
  });
  if (!ok) return [];
  return Array.isArray(data) ? data : [];
};

const getNextMatchFecha = async (torneoId) => {
  const { ok, data } = await selectRows("partidos", {
    torneo_id: `eq.${torneoId}`,
    select: "fecha"
  });
  if (!ok || !Array.isArray(data) || !data.length) return 1;
  const maxFecha = data.reduce((max, row) => Math.max(max, Number(row.fecha) || 0), 0);
  return maxFecha + 1;
};

const getMatchForFixture = async ({ torneoId, fecha = null, localClubId, awayClubId }) => {
  const loadRows = async (includeReplayUrl = true) => selectRows("partidos", {
    torneo_id: `eq.${torneoId}`,
    select: includeReplayUrl
      ? "id,fecha,club_local_id,club_visitante_id,jugado,goles_local,goles_visitante,reporte_raw,replay_url,club_local:clubes!club_local_id(nombre),club_visitante:clubes!club_visitante_id(nombre)"
      : "id,fecha,club_local_id,club_visitante_id,jugado,goles_local,goles_visitante,reporte_raw,club_local:clubes!club_local_id(nombre),club_visitante:clubes!club_visitante_id(nombre)"
  });

  let { ok, data, error } = await loadRows(true);
  if (!ok && /42703|replay_url does not exist/i.test(String(error || ""))) {
    ({ ok, data, error } = await loadRows(false));
  }
  if (!ok || !Array.isArray(data) || !data.length) return null;

  const normalizedLocal = String(localClubId || "").trim();
  const normalizedAway = String(awayClubId || "").trim();
  const normalizedFecha = fecha === null || fecha === undefined ? null : Number(fecha);

  const matchesPair = (row) => {
    const rowLocal = String(row.club_local_id || "").trim();
    const rowAway = String(row.club_visitante_id || "").trim();
    return (
      (rowLocal === normalizedLocal && rowAway === normalizedAway) ||
      (rowLocal === normalizedAway && rowAway === normalizedLocal)
    );
  };

  const candidates = data.filter(matchesPair);
  if (!candidates.length) return null;
  if (normalizedFecha !== null && Number.isFinite(normalizedFecha)) {
    return candidates.find((row) => Number(row.fecha) === normalizedFecha) || null;
  }
  const pending = candidates.filter((row) => !row.jugado);
  if (pending.length > 1 || (!pending.length && candidates.length > 1)) throw new Error("Hay varios partidos entre estos clubes. Indicá la fecha del informe.");
  return pending[0] || candidates[0] || null;
};

const setTournamentClub = async ({ torneoId, clubName, position = null, replaceClubId = null }) => {
  const club = await ensureClubRow(clubName);
  if (!club) return null;
  const payload = {
    torneo_id: torneoId,
    club_id: club.id,
    posicion: position === null || position === undefined ? null : Number(position)
  };

  if (replaceClubId) {
    await deleteRows("torneo_clubes", { torneo_id: `eq.${torneoId}`, club_id: `eq.${replaceClubId}` });
  }

  const upserted = await upsertRows("torneo_clubes", [payload], "torneo_id,club_id");
  return Array.isArray(upserted.data) ? upserted.data[0] || null : null;
};

const replaceDisabledTournamentClub = async ({ torneoId, incomingClubId, outgoingClubId, guildId }) => {
  const result = await request('rpc/bot_replace_disabled_club', {
    method: 'POST',
    body: { p_id: torneoId, p_new: incomingClubId, p_old: outgoingClubId, p_guild: String(guildId) },
    prefer: 'return=minimal'
  });
  if (!result.ok) throw new Error(result.error || `No se pudo reemplazar el cupo (HTTP ${result.status || 0})`);
  return true;
};

const upsertOfficialMatch = async ({ modality, torneoName, fecha, clubLocalName, clubVisitanteName, golesLocal, golesVisitante, reportContent, recUrl = null }) => {
  const torneo = await getTournament({ modality, name: torneoName });
  if (!torneo) return null;
  const local = await ensureClubRow(clubLocalName);
  const away = await ensureClubRow(clubVisitanteName);
  if (!local || !away) return null;

  const requestedFecha = fecha === null || fecha === undefined || fecha === "" ? null : Number(fecha);

  const matchRow = {
    torneo_id: torneo.id,
    club_local_id: local.id,
    club_visitante_id: away.id,
    goles_local: Number(golesLocal) || 0,
    goles_visitante: Number(golesVisitante) || 0,
    jugado: true,
    reporte_raw: reportContent || null,
    replay_url: recUrl || null
  };

  const existing = await getMatchForFixture({
    torneoId: torneo.id,
    fecha: requestedFecha,
    localClubId: local.id,
    awayClubId: away.id
  });

  matchRow.fecha = requestedFecha ?? (Number(existing?.fecha) || 1);

  const stripReplayUrl = (row) => {
    if (!row || typeof row !== "object") return row;
    const next = { ...row };
    delete next.replay_url;
    return next;
  };

  const retryWithoutReplayUrl = async (operation) => {
    const result = await operation().catch((error) => ({ ok: false, error }));
    const errorText = String(result?.error?.error || result?.error?.message || result?.error || "");
    if (!/42703|replay_url does not exist/i.test(errorText)) return result;
    console.warn("[haxoleSupabase] replay_url no existe en partidos; guardando el partido sin REC hasta aplicar la migracion.");
    return operation(true).catch(() => result);
  };

  if (existing?.id) {
    const updated = await retryWithoutReplayUrl((dropReplayUrl = false) =>
      patchRows("partidos", { id: `eq.${existing.id}` }, dropReplayUrl ? stripReplayUrl(matchRow) : matchRow)
    );
    return Array.isArray(updated.data) ? updated.data[0] || existing : existing;
  }

  const inserted = await retryWithoutReplayUrl((dropReplayUrl = false) =>
    insertRows("partidos", [dropReplayUrl ? stripReplayUrl(matchRow) : matchRow])
  );
  return Array.isArray(inserted.data) ? inserted.data[0] || null : null;
};

const removeTournamentClub = async ({ torneoId, clubId }) => {
  const currentRowsResult = await selectRows("torneo_clubes", {
    torneo_id: `eq.${torneoId}`,
    select: "id, torneo_id, club_id, posicion, created_at, club:clubes(*)"
  });
  const currentRows = Array.isArray(currentRowsResult.data) ? currentRowsResult.data : [];
  const removedRow = currentRows.find((row) => String(row.club_id) === String(clubId)) || null;

  if (!removedRow) {
    return { removed: false, removedFixtures: 0, resequenced: 0 };
  }

  await deleteRows("torneo_clubes", {
    torneo_id: `eq.${torneoId}`,
    club_id: `eq.${clubId}`
  });

  const fixtureDelete = await deleteRows("partidos", {
    torneo_id: `eq.${torneoId}`,
    club_local_id: `eq.${clubId}`,
    jugado: "eq.false"
  }).catch(() => null);
  const fixtureDelete2 = await deleteRows("partidos", {
    torneo_id: `eq.${torneoId}`,
    club_visitante_id: `eq.${clubId}`,
    jugado: "eq.false"
  }).catch(() => null);

  const remainingRows = currentRows
    .filter((row) => String(row.club_id) !== String(clubId))
    .sort((a, b) =>
      (Number(a.posicion) || 9999) - (Number(b.posicion) || 9999) ||
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
    );

  let resequenced = 0;
  for (let index = 0; index < remainingRows.length; index += 1) {
    const row = remainingRows[index];
    const desiredPosition = index + 1;
    if (Number(row.posicion) === desiredPosition) continue;
    const updated = await patchRows("torneo_clubes", { id: `eq.${row.id}` }, { posicion: desiredPosition });
    if (Array.isArray(updated.data) && updated.data.length) resequenced += 1;
  }

  const removedFixtures = Number(fixtureDelete?.ok ? 1 : 0) + Number(fixtureDelete2?.ok ? 1 : 0);
  return { removed: true, removedFixtures, resequenced };
};

const listFixtureRows = async (torneoId) => {
  const loadRows = async (includeReplayUrl = true) => selectRows("partidos", {
    torneo_id: `eq.${torneoId}`,
    select: includeReplayUrl
      ? "id,fecha,club_local_id,club_visitante_id,jugado,goles_local,goles_visitante,reporte_raw,replay_url,club_local:clubes!club_local_id(nombre,emoji_full,emoji_url),club_visitante:clubes!club_visitante_id(nombre,emoji_full,emoji_url)"
      : "id,fecha,club_local_id,club_visitante_id,jugado,goles_local,goles_visitante,reporte_raw,club_local:clubes!club_local_id(nombre,emoji_full,emoji_url),club_visitante:clubes!club_visitante_id(nombre,emoji_full,emoji_url)"
  });

  let { ok, data, error } = await loadRows(true);
  if (!ok && /42703|replay_url does not exist/i.test(String(error || ""))) {
    ({ ok, data, error } = await loadRows(false));
  }
  if (!ok) return [];
  return Array.isArray(data) ? data : [];
};

const deleteFixtureRows = async (torneoId) => {
  const removed = await deleteRows("partidos", { torneo_id: `eq.${torneoId}` });
  return Boolean(removed?.ok);
};

const createFixtureRows = async (rows) => {
  if (!Array.isArray(rows) || !rows.length) return [];
  const inserted = await insertRows("partidos", rows);
  return Array.isArray(inserted.data) ? inserted.data : [];
};

const listTorneosByModalidad = async (modality) => {
  const modalidad = await ensureModalidad(modality);
  if (!modalidad) return [];
  const { ok, data } = await selectRows("torneos", { modalidad_id: `eq.${modalidad.id}` });
  if (!ok) return [];
  return Array.isArray(data) ? tournamentScope.unambiguous(data) : [];
};

const listClubes = async () => {
  const { ok, data } = await selectRows("clubes");
  if (!ok) return [];
  return Array.isArray(data) ? data : [];
};

const getClubIdByName = async (clubName) => {
  const club = await getClubRowByName(clubName);
  return club?.id || null;
};

const syncPlayerTiersForModality = async (modality) => {
  // Legacy tables lack a league key. The web computes scoped tiers from official stats.
  if (tournamentScope.currentGuild() !== tournamentScope.TEST_GUILD) return { players: 0, clubs: 0, skipped: 'legacy-global-ranking' };
  const mod = roleRegistry.normalizeModality(modality);
  if (!mod) return { players: 0, clubs: 0 };

  const modalityRow = await ensureModalidad(mod);
  if (!modalityRow) return { players: 0, clubs: 0 };

  const entries = statsStore.readStore().entries.filter((entry) => entry?.modality === mod);
  const playerMap = new Map();

  for (const entry of entries) {
    const division = normalizeDivision(entry.division) || "sin-division";
    const key = `${division}:${String(entry.playerId || entry.userId || entry.jugador_nombre || "").trim()}`;
    if (!key) continue;
    const current = playerMap.get(key) || {
      jugador_nombre: entry.displayName || entry.userTag || entry.userName || entry.jugador_nombre || key,
      displayName: entry.displayName || entry.userTag || entry.userName || entry.jugador_nombre || key,
      playerId: entry.playerId || null,
      discordUserId: entry.discordUserId || entry.userId || null,
      clubName: entry.clubName || null,
      clubEmoji: entry.clubEmoji || null,
      division,
      goles: 0,
      asistencias: 0,
      partidos: new Set(),
      points: 0
    };

    if (entry.statType === "goles") current.goles += Number(entry.value) || 0;
    if (entry.statType === "asistencias") current.asistencias += Number(entry.value) || 0;
    if (entry.fecha !== undefined && entry.fecha !== null) current.partidos.add(String(entry.fecha));

    const weight = entry.statType === "goles" ? 1 : entry.statType === "asistencias" ? 0.5 : entry.statType === "valla_invicta" ? 1 / 300 : 0;
    current.points += (Number(entry.value) || 0) * weight;
    current.clubName = entry.clubName || current.clubName;
    current.clubEmoji = entry.clubEmoji || current.clubEmoji;
    current.division = division || current.division;
    current.playerId = entry.playerId || current.playerId;
    current.discordUserId = entry.discordUserId || current.discordUserId;
    current.displayName = entry.displayName || current.displayName;
    playerMap.set(key, current);
  }

  const getTierLabel = (position) => {
    if (position <= 5) return "HT1";
    if (position <= 10) return "LT1";
    if (position <= 25) return "HT2";
    if (position <= 50) return "LT2";
    if (position <= 75) return "HT3";
    if (position <= 100) return "LT3";
    if (position <= 125) return "HT4";
    return "LT4";
  };

  const playerRows = [];
  const clubRows = [];
  const bucketsByDivision = new Map();

  for (const player of playerMap.values()) {
    const division = player.division || "sin-division";
    const list = bucketsByDivision.get(division) || [];
    list.push(player);
    bucketsByDivision.set(division, list);
  }

  const matchRows = await listPlayedMatchesForModality(mod);
  const matchSummary = summarizeClubMatches(matchRows);

  for (const [division, players] of bucketsByDivision.entries()) {
    const sortedPlayers = players.slice().sort((a, b) =>
      b.points - a.points ||
      b.goles - a.goles ||
      b.asistencias - a.asistencias ||
      String(a.jugador_nombre).localeCompare(String(b.jugador_nombre), "es", { sensitivity: "base" })
    );

    const clubMap = new Map();
    for (let index = 0; index < sortedPlayers.length; index += 1) {
      const player = sortedPlayers[index];
      const club = player.clubName ? await ensureClubRow(player.clubName, { emoji: player.clubEmoji || null }) : null;
      playerRows.push({
        modalidad_id: modalityRow.id,
        division,
        jugador_id: player.playerId || null,
        jugador_nombre: player.displayName || player.jugador_nombre,
        club_id: club?.id || null,
        posicion_ranking: index + 1,
        goles_totales: player.goles,
        asistencias_totales: player.asistencias,
        partidos_jugados: player.partidos.size,
        updated_at: new Date().toISOString()
      });

      if (!player.clubName) continue;
      const current = clubMap.get(player.clubName) || {
        clubName: player.clubName,
        clubEmoji: player.clubEmoji || null,
        puntos: 0
      };
      current.puntos += player.points;
      current.clubEmoji = player.clubEmoji || current.clubEmoji;
      clubMap.set(player.clubName, current);
    }

    const sortedClubs = Array.from(clubMap.values()).sort((a, b) =>
      b.puntos - a.puntos ||
      String(a.clubName).localeCompare(String(b.clubName), "es", { sensitivity: "base" })
    );

    for (let index = 0; index < sortedClubs.length; index += 1) {
      const club = sortedClubs[index];
      const clubDb = await ensureClubRow(club.clubName, { emoji: club.clubEmoji || null });
      const summary = matchSummary.get(club.clubName) || { wins: 0, played: 0 };
      clubRows.push({
        modalidad_id: modalityRow.id,
        division,
        club_id: clubDb?.id || null,
        posicion_ranking: index + 1,
        puntos_totales: Math.round(club.puntos),
        partidos_ganados: summary.wins,
        partidos_jugados: summary.played,
        updated_at: new Date().toISOString()
      });
    }
  }

  await deleteRows("tiers", { modalidad_id: `eq.${modalityRow.id}` });
  if (playerRows.length) await insertRows("tiers", playerRows);
  await deleteRows("tiers_clubes", { modalidad_id: `eq.${modalityRow.id}` });
  if (clubRows.length) await insertRows("tiers_clubes", clubRows);

  return { players: playerRows.length, clubs: clubRows.length };
};

const listPlayedMatchesForModality = async (modality) => {
  const torneos = await listTorneosByModalidad(modality);
  const torneoIds = torneos.map((torneo) => torneo.id).filter(Boolean);
  if (!torneoIds.length) return [];

  const { ok, data } = await selectRows("partidos", {
    torneo_id: `in.(${torneoIds.join(",")})`,
    jugado: "eq.true",
    select: "id,torneo_id,fecha,club_local_id,club_visitante_id,goles_local,goles_visitante,jugado,replay_url,club_local:clubes!club_local_id(nombre),club_visitante:clubes!club_visitante_id(nombre)"
  });
  if (!ok) return [];
  return Array.isArray(data) ? data : [];
};

const summarizeClubMatches = (matches) => {
  const summary = new Map();
  for (const match of matches) {
    if (!match.club_local_id || !match.club_visitante_id || match.goles_local === null || match.goles_visitante === null) continue;

    const localName = match.club_local?.nombre || match.club_local?.name || null;
    const awayName = match.club_visitante?.nombre || match.club_visitante?.name || null;
    if (!localName || !awayName) continue;

    const local = summary.get(localName) || { wins: 0, played: 0 };
    const away = summary.get(awayName) || { wins: 0, played: 0 };
    local.played += 1;
    away.played += 1;
    if (Number(match.goles_local) > Number(match.goles_visitante)) local.wins += 1;
    else if (Number(match.goles_local) < Number(match.goles_visitante)) away.wins += 1;
    summary.set(localName, local);
    summary.set(awayName, away);
  }
  return summary;
};

const createOfficialMatch = async ({ modality, torneoName, fecha, clubLocalName, clubVisitanteName, golesLocal, golesVisitante, reportContent }) => {
  return upsertOfficialMatch({
    modality,
    torneoName,
    fecha,
    clubLocalName,
    clubVisitanteName,
    golesLocal,
    golesVisitante,
    reportContent
  });
};

const clearAllData = async () => {
  if (tournamentScope.currentGuild() !== tournamentScope.TEST_GUILD) throw new Error('El borrado global solo se permite desde PRUEBAS.');
  if (!isEnabled) {
    return { ok: false, skipped: true, error: "supabase-disabled", tables: [], docs: [] };
  }

  const tablesInOrder = [
    "jugador_aliases",
    "estadisticas_jugador",
    "partidos",
    "tiers_clubes",
    "tiers",
    "torneo_clubes",
    "jugadores",
    "torneos",
    "clubes",
    "modalidades",
    "bot_state_documents"
  ];

  const tableResults = [];
  for (const table of tablesInOrder) {
    const result = await deleteRows(table).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    tableResults.push({
      table,
      ok: Boolean(result?.ok),
      status: result?.status || 0,
      error: result?.error || null
    });
  }

  const docResults = [];
  for (const [name, value] of Object.entries(supabaseState.DEFAULT_DOCS || {})) {
    try {
      supabaseState.setDoc(name, value);
      docResults.push({ doc: name, ok: true });
    } catch (error) {
      docResults.push({ doc: name, ok: false, error: String(error?.message || error) });
    }
  }

  const ok = tableResults.every((entry) => entry.ok) && docResults.every((entry) => entry.ok);
  return {
    ok,
    skipped: false,
    tables: tableResults,
    docs: docResults
  };
};

module.exports = {
  isEnabled,
  request,
  ensureModalidad,
  getModalidadById,
  ensureClubRow,
  ensureTournament,
  getTournament,
  inspectTournamentRemoval,
  removeTournament,
  updateTournament,
  adjustTournamentSlots,
  addTournamentSlots,
  setTournamentForumLink,
  getTournamentByForumChannel,
  getTournamentClubRows,
  getNextMatchFecha,
  setTournamentClub,
  replaceDisabledTournamentClub,
  removeTournamentClub,
  listFixtureRows,
  deleteFixtureRows,
  createFixtureRows,
  getMatchForFixture,
  upsertOfficialMatch,
  listTorneosByModalidad,
  listClubes,
  getClubIdByName,
  parseCustomEmoji,
  normalizeDivision,
  normalizePlayerAlias,
  getPlayerById,
  getPlayerByDiscord,
  getPlayerByAlias,
  getPlayerValuation,
  setPlayerValuation,
  getModalidadRow,
  upsertPlayerIdentity,
  syncPlayerTiersForModality,
  createOfficialMatch,
  clearAllData
};
