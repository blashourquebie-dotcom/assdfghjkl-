const { PermissionFlagsBits } = require("discord.js");
const { readConfig, readUsers, saveConfig } = require("./database");
const clubs = require("./clubs");
const roleRegistry = require("./roleRegistry");

const FIRST_DIVISION = "1ra";
const SECOND_DIVISION = "2da";
const DIVISIONS = [FIRST_DIVISION, SECOND_DIVISION];

const normalizeDivision = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (["1", "1ra", "primera", "primera division", "primera división"].includes(raw)) return FIRST_DIVISION;
  if (["2", "2da", "segunda", "segunda division", "segunda división"].includes(raw)) return SECOND_DIVISION;
  return null;
};

const ensureBuckets = (cfg, guildId, modality) => {
  if (!cfg.clubDivisions || typeof cfg.clubDivisions !== "object") cfg.clubDivisions = {};
  if (!cfg.divisionRoles || typeof cfg.divisionRoles !== "object") cfg.divisionRoles = {};
  if (!cfg.divisionRoles[guildId] || typeof cfg.divisionRoles[guildId] !== "object") cfg.divisionRoles[guildId] = {};
  if (!cfg.divisionRoles[guildId][modality] || typeof cfg.divisionRoles[guildId][modality] !== "object") {
    cfg.divisionRoles[guildId][modality] = {};
  }
};

const getClubDivision = (cfg, clubName, modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!clubName || !mod) return null;
  return normalizeDivision(cfg?.clubDivisions?.[clubName]?.[mod]);
};

const setClubDivision = (cfg, clubName, modality, division) => {
  const mod = roleRegistry.normalizeModality(modality);
  const div = normalizeDivision(division);
  if (!clubName || !mod || !div) return false;
  if (!cfg.clubDivisions || typeof cfg.clubDivisions !== "object") cfg.clubDivisions = {};
  cfg.clubDivisions[clubName] = cfg.clubDivisions[clubName] || {};
  cfg.clubDivisions[clubName][mod] = div;
  return true;
};

const getFirstDivisionRole = (cfg, guildId, modality) => {
  return roleRegistry.getGeneralRole(cfg, guildId, modality, "player");
};

const secondDivisionRoleNames = (modality) => [
  `JugadorFut${modality} 2da`,
  `Jugador ${modality} 2da`,
  `jugador${modality} 2da`
];

const findRoleByName = (guild, names) => {
  const lowered = names.map((name) => name.toLowerCase());
  return guild.roles.cache.find((role) => lowered.includes(role.name.toLowerCase())) || null;
};

const ensureSecondDivisionRole = async (guild, cfg, modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!guild || !mod) return null;
  ensureBuckets(cfg, guild.id, mod);

  const stored = cfg.divisionRoles?.[guild.id]?.[mod]?.[SECOND_DIVISION]?.playerRoleId;
  if (stored) {
    const role = await guild.roles.fetch(stored).catch(() => null);
    if (role) return { roleId: role.id, name: role.name, created: false };
  }

  const names = secondDivisionRoleNames(mod);
  let role = findRoleByName(guild, names);
  let created = false;

  if (!role) {
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return null;
    role = await guild.roles.create({
      name: names[0],
      colors: { primaryColor: 0x99AAB5 },
      reason: `Rol general de jugador ${mod} segunda division`
    });
    created = true;
  }

  cfg.divisionRoles[guild.id][mod][SECOND_DIVISION] = {
    playerRoleId: role.id,
    playerRoleName: role.name,
    updatedAt: new Date().toISOString()
  };
  return { roleId: role.id, name: role.name, created };
};

const getDivisionPlayerRole = async (guild, cfg, modality, division, options = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  const div = normalizeDivision(division);
  if (!guild || !mod) return null;
  if (div === SECOND_DIVISION) {
    if (options.ensure === false) {
      const roleId = cfg.divisionRoles?.[guild.id]?.[mod]?.[SECOND_DIVISION]?.playerRoleId;
      if (!roleId) return null;
      const role = await guild.roles.fetch(roleId).catch(() => null);
      return role ? { roleId: role.id, name: role.name } : null;
    }
    return ensureSecondDivisionRole(guild, cfg, mod);
  }
  return getFirstDivisionRole(cfg, guild.id, mod);
};

const getClubPlayerRole = async (guild, cfg, clubName, modality, options = {}) => {
  const division = getClubDivision(cfg, clubName, modality) || FIRST_DIVISION;
  return getDivisionPlayerRole(guild, cfg, modality, division, options);
};

const collectClubMemberIds = async (guild, clubEntry, modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  const roleId = clubs.getRoleForClub(clubEntry, mod);
  if (!guild || !clubEntry || !mod || !roleId) return [];

  const ids = new Set();
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (role) {
    for (const member of role.members.values()) ids.add(member.id);
  }

  const users = readUsers();
  for (const [userId, userData] of Object.entries(users || {})) {
    if (userData?.clubRoles?.[mod] === roleId) ids.add(userId);
    if (userData?.clubAffiliations?.[clubEntry.name]?.modalities?.[mod]?.roleId === roleId) ids.add(userId);
  }

  return Array.from(ids);
};

const getAllDivisionPlayerRoleIds = (cfg, guildId, modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  const ids = new Set();
  const first = getFirstDivisionRole(cfg, guildId, mod);
  if (first?.roleId) ids.add(first.roleId);
  const second = cfg.divisionRoles?.[guildId]?.[mod]?.[SECOND_DIVISION]?.playerRoleId;
  if (second) ids.add(second);
  return ids;
};

const getNeededPlayerRoleIdsForMember = async (guild, member, cfg, modality, options = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  const needed = new Set();
  if (!guild || !member || !mod) return needed;

  for (const [clubName, clubEntry] of Object.entries(cfg.clubs || {})) {
    const clubRoleId = clubs.getRoleForClub({ name: clubName, ...clubEntry }, mod);
    if (!clubRoleId || !member.roles.cache.has(clubRoleId)) continue;
    const playerRole = await getClubPlayerRole(guild, cfg, clubName, mod, options);
    if (playerRole?.roleId) needed.add(playerRole.roleId);
  }

  return needed;
};

const syncMemberDivisionRoles = async (guild, member, cfg, modality, options = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!guild || !member || !mod) return { added: 0, removed: 0 };

  const freshMember = options.refreshMember === false
    ? member
    : await guild.members.fetch(member.id).catch(() => member);

  const needed = await getNeededPlayerRoleIdsForMember(guild, freshMember, cfg, mod, options);
  if (options.ensure !== false) saveConfig(cfg);
  const known = getAllDivisionPlayerRoleIds(cfg, guild.id, mod);
  for (const roleId of needed) known.add(roleId);

  let added = 0;
  let removed = 0;

  for (const roleId of needed) {
    if (!freshMember.roles.cache.has(roleId)) {
      await freshMember.roles.add(roleId, `Sincronizacion de division ${mod}`).catch(() => null);
      added += 1;
    }
  }

  for (const roleId of known) {
    if (!needed.has(roleId) && freshMember.roles.cache.has(roleId)) {
      await freshMember.roles.remove(roleId, `Sincronizacion de division ${mod}`).catch(() => null);
      removed += 1;
    }
  }

  return { added, removed };
};

const setClubDivisionAndSync = async (guild, clubEntry, modality, division) => {
  const cfg = readConfig();
  const mod = roleRegistry.normalizeModality(modality);
  const div = normalizeDivision(division);
  if (!guild || !clubEntry || !mod || !div) return null;
  if (!clubs.getRoleForClub(clubEntry, mod)) return null;

  setClubDivision(cfg, clubEntry.name, mod, div);
  await getDivisionPlayerRole(guild, cfg, mod, div, { ensure: true });
  saveConfig(cfg);

  const latest = readConfig();
  const memberIds = await collectClubMemberIds(guild, clubEntry, mod);
  let synced = 0;
  for (const userId of memberIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    await syncMemberDivisionRoles(guild, member, latest, mod, { ensure: true });
    synced += 1;
  }

  return { club: clubEntry.name, modality: mod, division: div, synced };
};

module.exports = {
  FIRST_DIVISION,
  SECOND_DIVISION,
  DIVISIONS,
  normalizeDivision,
  getClubDivision,
  setClubDivision,
  getDivisionPlayerRole,
  getClubPlayerRole,
  collectClubMemberIds,
  syncMemberDivisionRoles,
  setClubDivisionAndSync
};
