const isCaptain = (cfg, clubName, modality, userId) => {
  return String(cfg?.clubs?.[clubName]?.captains?.[modality] || "") === String(userId);
};

const isSubcaptain = (cfg, clubName, modality, userId) => {
  const subcaptains = cfg?.clubs?.[clubName]?.subcaptains || {};
  return (
    String(subcaptains.general || "") === String(userId) ||
    String(subcaptains[modality] || "") === String(userId)
  );
};

const isClubStaff = (cfg, clubName, modality, userId) => {
  return isCaptain(cfg, clubName, modality, userId) || isSubcaptain(cfg, clubName, modality, userId);
};

module.exports = {
  isCaptain,
  isSubcaptain,
  isClubStaff
};
