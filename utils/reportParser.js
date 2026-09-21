// Preserve names and line boundaries: they carry roster and team information.
const emojiSource = "<a?:[a-zA-Z0-9_]+:\\d+>|:[a-zA-Z0-9_&+\\-]+:";
const labels = /(?<![:\w])(autogoles|goles|g|asistencias|a|vallas?|v|mvp|figura|destacados?|dest|rec)\s*:/gi;
function parseReport(raw, resolveClub, resolveAlias = () => null) {
  const text = String(raw || "").replace(/\r/g, "").replace(/[–—]/g, "-");
  const score = text.match(/(\d+)\s*[-.xX]\s*(\d+)/);
  if (!score) return null;
  const tokens = [...text.matchAll(new RegExp(emojiSource, "g"))];
  const teamTokens = [...new Set(tokens.map((match) => match[0]))].slice(0, 2);
  const teams = teamTokens.map(resolveClub);
  const warnings = [];
  const df = /\bdf\b/i.test(text);
  if (teams.length !== 2 || teams.some((team) => !team?.name)) return { valid: false, warnings: ["Indicá los dos clubes, también en los informes por DF."], stats: [], score: { local: +score[1], away: +score[2] }, localClub: teams[0], awayClub: teams[1], recUrl: null };
  const rows = new Map();
  const rowFor = (name, side) => {
    name = name.trim().replace(/^[,;|\s-]+|[,;|\s-]+$/g, "");
    if (!name || side === null || side === undefined) return null;
    const id = name.match(/^<@!?(\d+)>$/)?.[1] || resolveAlias(name);
    const key = side + ":" + (id || name.toLowerCase());
    if (!rows.has(key)) rows.set(key, { clubName: teams[side].name, clubEmoji: teamTokens[side], playerName: name, sourceName: name, resolvedUserId: id, goles: 0, goles_contra: 0, asistencias: 0, valla_invicta_segundos: 0, es_mvp: false, es_destacado: false });
    return rows.get(key);
  };
  let input = text;
  const blocks = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!/(?:^|\s)(?:g|a|v|goles|asistencias|valla)\s*:/i.test(text) && blocks.length >= 5 && blocks[2].includes("|") && blocks[3].includes("|") && blocks[4].includes("|")) {
    const roster = blocks[1].split(/\s+-\s+/);
    const home = blocks[2].split("|"), away = blocks[3].split("|"), clean = blocks[4].split("|");
    if (roster.length === 2 && home.length === 2 && away.length === 2 && clean.length === 2) {
      input = [blocks[0], ...roster.map((names, index) => teamTokens[index] + " " + names),
        teamTokens[0] + " g: " + home[0], teamTokens[0] + " a: " + home[1],
        teamTokens[1] + " g: " + away[0], teamTokens[1] + " a: " + away[1],
        teamTokens[0] + " v: " + clean[0], teamTokens[1] + " v: " + clean[1], ...blocks.slice(5)].join("\n");
    }
  }
  const sections = input.replace(labels, "\n$1:").split("\n").map((line) => line.trim()).filter(Boolean);
  let side = null;
  let previousKind = null;
  let scoreProcessed = false;
  for (let line of sections) {
    if (!scoreProcessed && line.includes(score[0])) {
      scoreProcessed = true;
      // Score line may contain a roster after the second club.
      const second = line.indexOf(teamTokens[1]);
      line = second >= 0 ? line.slice(second + teamTokens[1].length).trim() : "";
      if (!line || /^df$/i.test(line)) continue;
    }
    const award = line.match(/^(mvp|figura|destacados?|dest)\s*:\s*(.*)$/i);
    if (award) {
      const assign = (rawName, clubSide) => {
        for (const name of rawName.split(/[,;|]|\s+-\s+/).map(s => s.trim()).filter(s => s && !/^[-—.]$/.test(s))) {
          const id = name.match(/^<@!?(\d+)>$/)?.[1] || resolveAlias(name);
          const candidates = [...rows.values()].filter(row => (clubSide == null || row.clubName === teams[clubSide].name) && (id ? row.resolvedUserId === id : row.playerName.toLowerCase() === name.toLowerCase()));
          if (candidates.length === 1) candidates[0][/^(mvp|figura)$/i.test(award[1]) ? "es_mvp" : "es_destacado"] = true;
          else warnings.push("No se pudo asignar " + award[1] + ": " + name);
        }
      };
      let offset = 0;
      for (const token of award[2].matchAll(new RegExp(emojiSource, "g"))) {
        const clubSide = teamTokens.indexOf(token[0]);
        assign(award[2].slice(offset, token.index), clubSide < 0 ? null : clubSide);
        offset = token.index + token[0].length;
      }
      assign(award[2].slice(offset), null);
      continue;
    }
    const explicit = teamTokens.findIndex((token) => line.includes(token));
    if (explicit >= 0) { side = explicit; line = line.split(teamTokens[explicit]).join("").trim(); }
    const label = line.match(/^(autogoles|goles|g|asistencias|a|vallas?|v|mvp|figura|destacados?|dest|rec)\s*:\s*(.*)$/i);
    if (!label) {
      if (/https?:\/\//i.test(line) || /^fecha\s+\d+/i.test(line)) continue;
      if (side !== null) {
        for (const name of line.split(/\s+-\s+|[,;|]|\s+(?=<@)/).filter(Boolean)) rowFor(name, side);
      } else if (line.includes(" - ")) {
        const rosters = line.split(/\s+-\s+/);
        if (rosters.length === 2) rosters.forEach((roster, index) => roster.split(/\s+/).filter(Boolean).forEach((name) => rowFor(name, index)));
        else warnings.push("Alineaciones ambiguas: agregá el emoji antes de cada equipo.");
      } else warnings.push("Bloque sin etiqueta: agregá Goles:, Asistencias: o Valla:.");
      continue;
    }
    const kind = label[1].toLowerCase(); const body = label[2];
    if (kind === "rec") continue;
    if (side === null && /^[gav]/.test(kind)) side = 0;
    if (/^(g|goles)$/.test(kind) && /^(v|valla|vallas)$/.test(previousKind || "") && explicit < 0) side = 1;
    previousKind = kind;
    const entries = body.split(/[,;|]|\s+-\s+/).flatMap((chunk) => chunk.trim().split(/(?<=\dx?)\s+(?=[\p{L}<])/u));
    for (let entry of entries) {
      if (!entry.trim()) continue;
      let count = 1;
      const multiplier = entry.match(/\s*:?\s*x\s*(\d+)\b/i);
      if (multiplier) { count = +multiplier[1]; entry = entry.replace(multiplier[0], ""); }
      else if (/^(g|goles|a|asistencias)$/.test(kind) && !resolveAlias(entry.trim())) {
        const suffix = entry.match(/^([\p{L}_]+)(\d+)$/u);
        if (suffix) { entry = suffix[1]; count = Number(suffix[2]); }
      }
      const ownGoal = /\b(?:e\/c|ec|ag)\b/i.test(entry);
      entry = entry.replace(/\b(?:e\/c|ec|ag)\b/gi, "").trim();
      if (/^(mvp|figura|dest|destacado|destacados)$/.test(kind)) {
        const name = entry.trim().toLowerCase();
        const id = entry.match(/<@!?(\d+)>/)?.[1] || resolveAlias(entry);
        const candidates = [...rows.values()].filter((row) => id ? row.resolvedUserId === id : row.playerName.toLowerCase() === name);
        if (candidates.length === 1) candidates[0][/^(mvp|figura)$/.test(kind) ? "es_mvp" : "es_destacado"] = true;
        else warnings.push("No se pudo asignar " + kind + ": " + entry);
        continue;
      }
      let seconds = 0;
      if (/^v/.test(kind)) {
        const clock = entry.match(/\(?\b(\d+)[.:](\d{2})\)?/);
        const sec = entry.match(/\b(\d+)\s*s(?:eg(?:undos)?)?\b/i);
        if (clock) { seconds = +clock[1] * 60 + +clock[2]; entry = entry.replace(clock[0], ""); }
        else if (sec) { seconds = +sec[1]; entry = entry.replace(sec[0], ""); }
        else warnings.push("Falta el tiempo exacto de valla: " + entry);
      }
      const row = rowFor(entry, side);
      if (!row) continue;
      if (kind === "autogoles" || /^g/.test(kind)) row[ownGoal || kind === "autogoles" ? "goles_contra" : "goles"] += count;
      if (/^(a|asistencias)$/.test(kind)) row.asistencias += count;
      if (/^v/.test(kind)) row.valla_invicta_segundos += seconds;
    }
  }
  return { valid: true, warnings: [...new Set(warnings)], fecha: Number(text.match(/\bfecha\s*:?\s*(\d+)/i)?.[1]) || null, df, score: { local: +score[1], away: +score[2] }, localClub: teams[0], awayClub: teams[1], stats: df ? [] : [...rows.values()], recUrl: text.match(/https?:\/\/[^\s<>]+/i)?.[0] || null };
}
module.exports = { parseReport };
