const timestamp = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const signingTime = (user, clubName, modality) => {
  const affiliation = user?.clubAffiliations?.[clubName]?.modalities?.[modality];
  const stored = timestamp(affiliation?.signedAt);
  if (stored !== null) return stored;
  const history = (user?.history || [])
    .filter((entry) => entry?.action === "FICHO"
      && entry?.details?.club === clubName
      && entry?.details?.modality === modality)
    .map((entry) => timestamp(entry.timestamp))
    .filter((value) => value !== null);
  return history.length ? Math.max(...history) : null;
};

const latestExcessSignings = (members, users, clubName, modality, limit) => {
  const excess = members.length - limit;
  if (excess <= 0) return { excess: 0, selected: [], undated: [] };
  const ranked = members.map((member) => ({ member, at: signingTime(users[member.id], clubName, modality) }));
  const undated = ranked.filter((entry) => entry.at === null).map((entry) => entry.member.id);
  if (undated.length) return { excess, selected: [], undated };
  ranked.sort((a, b) => b.at - a.at || String(b.member.id).localeCompare(String(a.member.id)));
  if (ranked[excess - 1]?.at === ranked[excess]?.at) {
    return { excess, selected: [], undated: [], ambiguous: true };
  }
  return { excess, selected: ranked.slice(0, excess).map((entry) => entry.member), undated: [] };
};

const subcaptainTime = (user, clubName, modality) => {
  const history = (user?.history || [])
    .filter((entry) => entry?.action === "SC"
      && entry?.details?.club === clubName
      && (!entry?.details?.modality || entry.details.modality === modality))
    .map((entry) => timestamp(entry.timestamp))
    .filter((value) => value !== null);
  return history.length ? Math.max(...history) : null;
};

module.exports = { latestExcessSignings, signingTime, subcaptainTime };
