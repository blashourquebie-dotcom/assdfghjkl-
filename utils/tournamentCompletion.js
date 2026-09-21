const { buildNextRound, groupCount, validateConfig } = require("./tournamentFormat");

function assertTournamentComplete(tournament, matches) {
  if (!matches.length) throw new Error("El torneo no tiene fixture: no se puede finalizar.");
  if (matches.some((m) => !m.jugado)) throw new Error("Todavía hay partidos pendientes. Cargá todos los resultados antes de finalizar.");
  if (matches.some((m) => !Number.isInteger(m.goles_local) || !Number.isInteger(m.goles_visitante) || m.goles_local < 0 || m.goles_visitante < 0)) throw new Error("Hay partidos sin un marcador válido.");
  const config = { ...tournament.configuracion, formato: tournament.formato || (tournament.modo_copa ? "copa" : "liga") };
  const count = Number(tournament.cantidad_equipos);
  const legs = config.ida_vuelta ? 2 : 1;
  if (!Number.isInteger(count) || count < 2) throw new Error("Revisá la cantidad de equipos del torneo.");
  if (config.formato === "liga") {
    const expected = count * (count - 1) / 2 * legs;
    const pairs = new Map();
    const clubs = new Set();
    matches.forEach((m) => {
      if (!m.club_local_id || !m.club_visitante_id || m.club_local_id === m.club_visitante_id) throw new Error("El fixture tiene un cruce inválido.");
      clubs.add(m.club_local_id); clubs.add(m.club_visitante_id);
      const key = [m.club_local_id, m.club_visitante_id].sort().join("/");
      pairs.set(key, (pairs.get(key) || 0) + 1);
    });
    if (matches.length !== expected || clubs.size !== count || pairs.size !== count * (count - 1) / 2 || [...pairs.values()].some((n) => n !== legs)) throw new Error("El fixture de liga está incompleto o tiene cruces duplicados.");
    return;
  }
  if (!["copa", "dos_grupos", "libertadores"].includes(config.formato)) throw new Error("Este formato todavía no permite verificar la finalización.");
  validateConfig(config, count);
  const groups = config.formato === "copa" ? 0 : groupCount(config);
  if (groups) buildNextRound(matches.filter((m) => m.fase === "grupos"), config);
  const expectedMatches = config.formato === "copa"
    ? (count - 1) * legs
    : (count * (count / groups - 1) / 2 + groups * Number(config.clasifican) - 1) * legs;
  if (matches.length !== expectedMatches) throw new Error("El fixture no contiene todos los partidos del formato configurado.");
  const expectedRound = config.formato === "copa" ? Math.ceil(Math.log2(count)) : 1 + Math.log2(groups * Number(config.clasifican));
  const lastRound = Math.max(...matches.map((m) => m.ronda || 1));
  if (!Number.isInteger(expectedRound) || lastRound !== expectedRound) throw new Error("Faltan rondas eliminatorias: generá y disputá la final.");
  const result = buildNextRound(matches, config);
  if (!result.champion) throw new Error("Todavía no se disputó una final con ganador definido.");
}

module.exports = { assertTournamentComplete };
