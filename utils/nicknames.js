const { readConfig } = require("./database");
const clubs = require("./clubs");
const { PermissionsBitField } = require("discord.js");

const stripNickTags = (nick) => clubs.stripNickTags(nick);

const normalizeModal = (m) => {
  if (!m) return null;
  m = String(m).toLowerCase().replace(/\s+/g, "");
  m = m.replace(/^fut[-_]?x?/, "x");
  if (/^x\d+$/.test(m)) return m;
  return m.replace(/(rs)[-_]?(x\d+)/, "rs-$2");
};

const buildRoleToAbbrMap = (cfg) => {
  const roleToAbbr = {};
  for (const [clubName, clubEntry] of Object.entries(cfg.clubs || {})) {
    if (!clubEntry || !clubEntry.roles) continue;
    for (const [rawMod, roleId] of Object.entries(clubEntry.roles)) {
      const mod = normalizeModal(rawMod);
      if (!mod || !roleId) continue;
      if (!roleToAbbr[mod]) roleToAbbr[mod] = {};
      roleToAbbr[mod][roleId] = String(clubEntry.abbr || clubName).toUpperCase();
    }
  }
  return roleToAbbr;
};

const collectPrefixParts = (member, cfg) => {
  const modalities = (cfg.enabledModalities || []).map(normalizeModal).filter(Boolean);
  const roleToAbbr = buildRoleToAbbrMap(cfg);
  const seen = new Set();
  const prefixParts = [];

  for (const mod of modalities) {
    for (const [roleId, abbr] of Object.entries(roleToAbbr[mod] || {})) {
      if (!member.roles.cache.has(roleId)) continue;
      if (!seen.has(abbr)) {
        seen.add(abbr);
        prefixParts.push(`#${abbr}`);
      }
      break;
    }
  }

  return prefixParts;
};

const buildNickname = (member, cfg = readConfig()) => {
  const prefixParts = collectPrefixParts(member, cfg);
  const base = stripNickTags(member.displayName || member.user.username);
  const rawNick = `${prefixParts.join(" ")} ${base}`.trim();
  const newNick = rawNick.length > 32 ? rawNick.slice(0, 32).trim() : rawNick;
  return { newNick, prefixParts };
};

const updateNickname = async (member) => {
  try {
    const cfg = readConfig();
    const { newNick, prefixParts } = buildNickname(member, cfg);
    const desiredNick = newNick || stripNickTags(member.displayName || member.user.username);

    const me = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
    if (!me) {
      console.warn("[nicknames] no se pudo resolver guild.members.me para", member.guild.id);
      return;
    }

    if (!me.permissions.has(PermissionsBitField.Flags.ManageNicknames)) return;

    const myHighestRole = me.roles.highest?.position ?? -1;
    const targetHighestRole = member.roles.highest?.position ?? -1;

    if (!member.manageable) return;

    if ((member.nickname || member.user.username) === desiredNick) return;

    console.log(`[nicknames] setting nickname for ${member.user.tag} (${member.id}) -> "${desiredNick}" [${prefixParts.join(", ")}]`);
    await member.setNickname(desiredNick, "Actualizar apodo por roles de club");
    console.log(`[nicknames] nickname set for ${member.user.tag} (${member.id})`);
  } catch (err) {
    console.error("[nicknames] updateNickname error:", err?.code, err?.message || err);
  }
};

const computeNickname = async (member) => {
  try {
    const { newNick, prefixParts } = buildNickname(member);
    return { newNick, prefixParts, memberClubs: Object.fromEntries(prefixParts.map(p => [p.replace(/^#/, ""), true])) };
  } catch (err) {
    console.error("computeNickname error", err);
    return { newNick: null, prefixParts: [], memberClubs: {} };
  }
};

module.exports = {
  updateNickname,
  computeNickname,
  stripNickTags
};
