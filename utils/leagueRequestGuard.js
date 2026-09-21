const scope = require('./tournamentScope');

// Every bot-side write must prove its guild and ownership, including ID-based RPCs.
// Read callbacks are transport-only, never recursive calls through this guard.
async function guard(path, options, read) {
  let { method = 'GET', params = {}, body = null, prefer = 'return=representation' } = options;
  params = { ...params };
  const guild = scope.currentGuild();
  const league = scope.leagueForGuild(guild);
  const readLeague = scope.currentLeague();
  const deny = (message = 'La operación pertenece a otra liga o no tiene un alcance verificable.') => {
    throw Object.assign(new Error(message), { code: 'LEAGUE_SCOPE_DENIED' });
  };
  const rows = value => Array.isArray(value) ? value : value ? [value] : [];
  const readAll = async (table, filters, columns) => {
    const result = [];
    for (let offset = 0; ; offset += 500) {
      const response = await read(table, { method: 'GET', params: { ...filters, select: columns, order: 'id.asc', offset, limit: 500 } });
      if (!response.ok || !Array.isArray(response.data)) deny('No pude verificar la liga. No se realizó el cambio.');
      result.push(...response.data);
      if (response.data.length < 500) return result;
    }
  };
  const assertTournament = async id => {
    if (!id) deny();
    const result = await readAll('torneos', { id: 'eq.' + id }, 'id,tipo');
    if (result.length !== 1 || result[0].tipo !== league) deny();
  };
  const assertMatch = async id => {
    const found = await readAll('partidos', { id: 'eq.' + id }, 'id,torneo_id,club_local_id,club_visitante_id');
    if (found.length !== 1) deny();
    await assertTournament(found[0].torneo_id);
    return found[0];
  };
  const assertPlayer = async id => {
    const found = await readAll('jugadores', { id: 'eq.' + id }, 'id,discord_guild_id');
    if (found.length !== 1 || found[0].discord_guild_id !== guild) deny();
  };
  if (method === 'GET') {
    if (path === 'torneos' && readLeague) {
      if (league && params.tipo && params.tipo !== 'eq.' + league) deny('Desde este servidor solo podés consultar torneos de ' + league + '.');
      if (league || !params.tipo) params.tipo = 'eq.' + readLeague;
    }
    return { ...options, params };
  }
  if (!scope.allowedGuild(guild)) deny('Falta un servidor autorizado para realizar el cambio.');
  if (guild === scope.TEST_GUILD) return options;
  if (path.startsWith('rpc/')) {
    if (['rpc/configure_cup_byes', 'rpc/append_configured_tournament_fixture', 'rpc/append_tournament_fixture'].includes(path)) {
      await assertTournament(body?.p_tournament);
      for (const row of rows(body?.p_rows)) {
        if (row.torneo_id && row.torneo_id !== body.p_tournament) deny();
      }
    } else if (path === 'rpc/publish_approved_report') {
      const match = await assertMatch(body?.p_match_id);
      for (const row of rows(body?.p_stats)) {
        if (row.club_id && ![match.club_local_id, match.club_visitante_id].includes(row.club_id)) deny();
        if (row.jugador_id) await assertPlayer(row.jugador_id);
      }
    } else deny('Esta operación global solo está disponible en PRUEBAS.');
    return options;
  }
  if (path === 'torneos') {
    for (const row of rows(body)) {
      if ((method === 'POST' && row.tipo !== league) || (row.tipo && row.tipo !== league)) deny();
      if (row.id) await assertTournament(row.id);
    }
    if (method !== 'POST') {
      if (params.tipo && params.tipo !== 'eq.' + league) deny();
      params.tipo = 'eq.' + league;
    }
  } else if (['partidos', 'torneo_clubes', 'estadisticas_jugador', 'jugador_aliases'].includes(path)) {
    const field = ['partidos', 'torneo_clubes'].includes(path) ? 'torneo_id' : path === 'estadisticas_jugador' ? 'partido_id' : 'jugador_id';
    const check = field === 'torneo_id' ? assertTournament : field === 'partido_id' ? assertMatch : assertPlayer;
    const verified = new Set();
    const verify = async id => { if (!verified.has(id)) { await check(id); verified.add(id); } };
    for (const row of rows(body)) {
      if (row[field] || method === 'POST') await verify(row[field]);
      if (path === 'jugador_aliases') {
        if (row.discord_guild_id && row.discord_guild_id !== guild) deny();
        for (const id of [row.first_torneo_id, row.last_torneo_id].filter(Boolean)) await assertTournament(id);
      }
      if (row.id) {
        const existing = await readAll(path, { id: 'eq.' + row.id }, 'id,' + field);
        for (const old of existing) await verify(old[field]);
      }
      if (path === 'estadisticas_jugador' && row.jugador_id) await assertPlayer(row.jugador_id);
    }
    if (method !== 'POST') {
      // Require a bounded target; never allow a generic delete/update of shared data.
      if (!params.id && !params[field]) deny();
      const targets = await readAll(path, params, 'id,' + field);
      for (const target of targets) await verify(target[field]);
      const ids = [...new Set(targets.map(row => row[field]))];
      // Extra AND predicate preserves scope if a row is concurrently reassigned.
      const restriction = field + '.in.(' + (ids.join(',') || '00000000-0000-0000-0000-000000000000') + ')';
      params.and = params.and ? '(' + params.and.slice(1, -1) + ',' + restriction + ')' : '(' + restriction + ')';
    }
  } else if (path === 'jugadores') {
    for (const row of rows(body)) {
      if ((method === 'POST' && row.discord_guild_id !== guild) || (row.discord_guild_id && row.discord_guild_id !== guild)) deny();
      if (row.id) await assertPlayer(row.id);
    }
    if (method !== 'POST') params.discord_guild_id = 'eq.' + guild;
  } else if (path === 'modalidades' && method === 'POST') {
    if (rows(body).some(row => row.id || !row.nombre || Object.keys(row).some(key => !['nombre', 'descripcion'].includes(key)))) deny();
    // Shared catalog: reuse an existing modality without overwriting another league's metadata.
    prefer = prefer.replace('resolution=merge-duplicates', 'resolution=ignore-duplicates');
  } else if (path === 'clubes' && method === 'POST' && !params.on_conflict) {
    if (rows(body).some(row => row.id)) deny();
  } else {
    deny('El catálogo o ranking compartido solo se puede modificar globalmente desde PRUEBAS.');
  }
  return { ...options, params, prefer };
}
module.exports = { guard };
