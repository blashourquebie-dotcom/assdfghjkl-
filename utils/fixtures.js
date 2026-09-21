const clubs = require("./clubs");

const normalizeClubName = (row) => String(row?.club?.nombre || row?.club?.name || row?.nombre || row?.club_name || "").trim();

const buildRoundRobinFixture = (clubRows) => {
  const teams = clubRows
    .map((row, index) => ({
      id: String(row.club_id || row.id || index),
      name: normalizeClubName(row),
      row
    }))
    .filter((team) => team.name && team.id);

  if (teams.length < 2) return { rounds: [], teams };

  const ordered = [...teams];
  if (ordered.length % 2 === 1) ordered.push({ id: "__bye__", name: null, row: null });

  const fixed = ordered[0];
  let rotating = ordered.slice(1);
  const rounds = [];
  const totalRounds = ordered.length - 1;

  for (let round = 0; round < totalRounds; round += 1) {
    const bracket = [fixed, ...rotating];
    const matches = [];

    for (let i = 0; i < bracket.length / 2; i += 1) {
      const home = bracket[i];
      const away = bracket[bracket.length - 1 - i];
      if (!home?.id || !away?.id) continue;
      if (home.id === "__bye__" || away.id === "__bye__") continue;
      matches.push({
        fecha: round + 1,
        local: home,
        visitante: away
      });
    }

    rounds.push({ fecha: round + 1, matches });

    if (rotating.length > 1) {
      rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
    }
  }

  return { rounds, teams: ordered.filter((team) => team.id !== "__bye__") };
};

const formatFixtureView = (fixtureRows) => {
  const grouped = new Map();

  for (const row of fixtureRows || []) {
    const fecha = Number(row.fecha) || 1;
    if (!grouped.has(fecha)) grouped.set(fecha, []);
    grouped.get(fecha).push(row);
  }

  const lines = [];
  const sortedDates = Array.from(grouped.keys()).sort((a, b) => a - b);
  for (const fecha of sortedDates) {
    lines.push(`FECHA ${fecha}`);
    const rows = grouped.get(fecha) || [];
    rows.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
    for (const row of rows) {
      const local = String(row?.club_local?.nombre || row?.club_local?.name || row?.club_local_name || "").trim();
      const away = String(row?.club_visitante?.nombre || row?.club_visitante?.name || row?.club_visitante_name || "").trim();
      lines.push(`${local || "Libre"} vs ${away || "Libre"}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
};

module.exports = {
  buildRoundRobinFixture,
  formatFixtureView
};
