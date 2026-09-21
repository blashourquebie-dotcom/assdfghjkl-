const { buildRoundRobinFixture } = require("./fixtures");

const hasGroups = (config) => ["dos_grupos", "libertadores"].includes(config.formato);
const groupCount = (config) => config.formato === "dos_grupos" ? 2 : config.grupos;

function validateConfig(config, count) {
  if (!["liga", "copa", "dos_grupos", "libertadores"].includes(config.formato)) throw new Error("Formato inválido.");
  if (!Number.isInteger(count) || count < 2) throw new Error("Se necesitan al menos dos clubes.");
  if (count > 128) throw new Error("Se admiten hasta 128 clubes por torneo.");
  if (config.formato === "copa" && count > 32) throw new Error("Copa admite hasta 32 clubes.");
  if (config.formato === "dos_grupos" && (count < 4 || count % 2)) throw new Error("Dos grupos requiere una cantidad par de al menos 4 clubes.");
  if (hasGroups(config)) {
    const groups = groupCount(config);
    if (!Number.isInteger(groups) || groups < 2 || groups > 16 || groups % 2) throw new Error("Elegí una cantidad par de grupos, entre 2 y 16.");
    if (count % groups || count / groups < 2) throw new Error("Todos los grupos deben tener la misma cantidad de clubes, al menos dos.");
    if (config.equipos_por_grupo != null && config.equipos_por_grupo !== count / groups) throw new Error("La cantidad de equipos no coincide con los grupos configurados.");
    const n = config.clasifican;
    const total = n * groups;
    if (!Number.isInteger(n) || n < 1 || n > count / groups || total > 32 || (total & (total - 1))) throw new Error("Los clasificados totales deben ser 2, 4, 8, 16 o 32, sin superar los equipos por grupo.");
  }
  for (const tag of config.etiquetas || []) {
    if (!Number.isInteger(tag.desde) || !Number.isInteger(tag.hasta) || tag.desde < 1 || tag.hasta < tag.desde || tag.hasta > count || !/^#[0-9a-f]{6}$/i.test(tag.color) || !tag.texto?.trim() || tag.texto.length > 50) throw new Error("Etiqueta inválida: usá desde-hasta | #RRGGBB | texto (máximo 50 caracteres).");
  }
}

function buildInitialFixture(rows, config) {
  validateConfig(config, rows.length);
  const teams = rows.map((row) => ({ ...row, id: row.club_id || row.id, nombre: row.nombre || row.club?.nombre || String(row.club_id || row.id || "") }));
  if (teams.some((t) => !t.id) || new Set(teams.map((t) => t.id)).size !== teams.length) throw new Error("Hay clubes duplicados o sin identificar.");
  const byes = config.formato === "copa" ? (config.pases_libres || []) : [];
  if (config.formato === "copa") {
    const required = 2 ** Math.ceil(Math.log2(teams.length)) - teams.length;
    if (!Array.isArray(byes) || byes.length !== required || new Set(byes).size !== byes.length || byes.some((id) => !teams.some((t) => t.id === id))) throw new Error("Elegí exactamente " + required + " clubes inscriptos con pase libre usando /torneo antes de generar el fixture.");
  }
  const playing = teams.filter((team) => !byes.includes(team.id));
  const groups = hasGroups(config) ? Array.from({ length: groupCount(config) }, (_, index) => teams.filter((_, i) => i % groupCount(config) === index)) : [playing];
  const result = [];
  groups.forEach((group, groupIndex) => {
    const matches = config.formato === "copa"
      ? group.filter((_, i) => i % 2 === 0).map((team, i) => ({ fecha: 1, local: team, visitante: group[i * 2 + 1] }))
      : buildRoundRobinFixture(group).rounds.flatMap((round) => round.matches);
    const dates = Math.max(...matches.map((m) => m.fecha), 0);
    matches.forEach((match, index) => {
      const base = { fecha: match.fecha, club_local_id: match.local.id, club_visitante_id: match.visitante.id, fase: config.formato === "copa" ? "eliminacion" : hasGroups(config) ? "grupos" : "liga", grupo: hasGroups(config) ? String.fromCharCode(65 + groupIndex) : null, ronda: 1, llave: index + 1, vuelta: 1 };
      result.push(base);
      if (config.formato === "copa") base.llave += byes.length;
      if (config.ida_vuelta) result.push({ ...base, fecha: match.fecha + dates, club_local_id: base.club_visitante_id, club_visitante_id: base.club_local_id, vuelta: 2 });
    });
  });
  return result;
}

function buildNextRound(matches, config) {
  if (config.formato === "liga") throw new Error("Una liga no tiene rondas eliminatorias.");
  if (!matches.length || matches.some((m) => !m.jugado)) throw new Error("Todavía hay partidos pendientes.");
  if (matches.some((m) => !Number.isInteger(m.goles_local) || !Number.isInteger(m.goles_visitante) || m.goles_local < 0 || m.goles_visitante < 0)) throw new Error("Hay marcadores inválidos.");
  const lastRound = Math.max(...matches.map((m) => m.ronda || 1));
  const current = matches.filter((m) => (m.ronda || 1) === lastRound);
  let qualified = [];
  if (current[0].fase === "grupos") {
    const groups = [...new Set(current.map((m) => m.grupo))].sort();
    const ids = new Set(current.flatMap((m) => [m.club_local_id, m.club_visitante_id]));
    validateConfig(config, ids.size);
    if (groups.length !== groupCount(config) || groups.some((g, i) => g !== String.fromCharCode(65 + i))) throw new Error("Faltan grupos en el fixture.");
    const memberships = new Map();
    for (const group of groups) {
      const games = current.filter((m) => m.grupo === group);
      const clubs = new Set(games.flatMap((m) => [m.club_local_id, m.club_visitante_id]));
      const size = ids.size / groups.length;
      const legs = config.ida_vuelta ? 2 : 1;
      const pairs = new Map();
      for (const id of clubs) {
        if (memberships.has(id)) throw new Error("Un club figura en más de un grupo.");
        memberships.set(id, group);
      }
      for (const m of games) {
        if (m.club_local_id === m.club_visitante_id) throw new Error("Cruce inválido dentro del grupo.");
        const key = [m.club_local_id, m.club_visitante_id].sort().join("/");
        const pair = pairs.get(key) || [];
        pair.push(m); pairs.set(key, pair);
      }
      if (clubs.size !== size || pairs.size !== size * (size - 1) / 2 || [...pairs.values()].some((pair) => pair.length !== legs || (legs === 2 && pair[0].club_local_id === pair[1].club_local_id))) throw new Error("El fixture del grupo " + group + " está incompleto o tiene cruces duplicados.");
    }
    const ranked = groups.map((group) => {
      const scores = new Map();
      const team = (id) => { if (!scores.has(id)) scores.set(id, { id, points: 0, gf: 0, ga: 0 }); return scores.get(id); };
      current.filter((m) => m.grupo === group).forEach((m) => {
        const home = team(m.club_local_id), away = team(m.club_visitante_id);
        home.gf += m.goles_local; home.ga += m.goles_visitante; away.gf += m.goles_visitante; away.ga += m.goles_local;
        home.points += m.goles_local > m.goles_visitante ? 3 : m.goles_local === m.goles_visitante ? 1 : 0;
        away.points += m.goles_visitante > m.goles_local ? 3 : m.goles_local === m.goles_visitante ? 1 : 0;
      });
      const sorted = [...scores.values()].sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
      for (let i = 1; i <= config.clasifican && i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        if (a.points === b.points && a.gf === b.gf && a.ga === b.ga) throw new Error("Empate de clasificación en grupo " + group + ": hace falta definir el desempate deportivo.");
      }
      return sorted.slice(0, config.clasifican).map((t) => t.id);
    });
    // Cruces deterministas: A1-B2, A2-B1, C1-D2, C2-D1, etc.
    for (let g = 0; g < ranked.length; g += 2) {
      for (let i = 0; i < config.clasifican; i++) qualified.push(ranked[g][i], ranked[g + 1][config.clasifican - 1 - i]);
    }
  } else {
    for (const key of [...new Set(current.map((m) => m.llave))].sort((a, b) => a - b)) {
      const legs = current.filter((m) => m.llave === key);
      if (legs.length !== (config.ida_vuelta ? 2 : 1)) throw new Error("Llave incompleta.");
      const home = legs[0].club_local_id, away = legs[0].club_visitante_id;
      let homeScore = 0, awayScore = 0;
      legs.forEach((m) => { homeScore += m.club_local_id === home ? m.goles_local : m.goles_visitante; awayScore += m.club_local_id === home ? m.goles_visitante : m.goles_local; });
      if (homeScore === awayScore) throw new Error("Llave empatada: falta resolver el desempate antes de avanzar.");
      qualified.push(homeScore > awayScore ? home : away);
    }
  }
  if (config.formato === "copa" && lastRound === 1) qualified.unshift(...(config.pases_libres || []));
  if (new Set(qualified).size !== qualified.length) throw new Error("Hay clubes duplicados en la clasificación.");
  if (qualified.length === 1) return { champion: qualified[0], rows: [] };
  const offset = Math.max(...matches.map((m) => m.fecha));
  const rows = buildInitialFixture(qualified.map((id) => ({ id, nombre: id })), { ...config, formato: "copa", pases_libres: [] }).map((m) => ({ ...m, ronda: lastRound + 1, fecha: m.fecha + offset }));
  return { champion: null, rows };
}

module.exports = { validateConfig, buildInitialFixture, buildNextRound, hasGroups, groupCount };
