const { readConfig, readUsers, saveConfig, saveUsers, withGuild } = require("./database");
const clubs = require("./clubs");
const roleRegistry = require("./roleRegistry");
const validators = require("./validators");
const haxoleSupabase = require("./haxoleSupabase");
const loadedGuilds = new WeakSet();
const memberLoads = new WeakMap();

const ensureGuildMembersLoaded = async (guild) => {
  if (loadedGuilds.has(guild)) return true;
  if (!memberLoads.has(guild)) {
    const loading = guild.members.fetch({ force: true, time: 30000 })
      .then(() => { loadedGuilds.add(guild); return true; })
      .finally(() => memberLoads.delete(guild));
    memberLoads.set(guild, loading);
  }
  return memberLoads.get(guild);
};

const DEFAULT_CLUB_EMOJI = "<:HaxOle:1495228748851839240>";
const CAPTAIN_EMOJI = "<:CAPITAN:1446933863795392674>";
const SUBCAPTAIN_MARKER = "SC";
const DEFAULT_COUNTRY_EMOJI = "\u{1F1E6}\u{1F1F7}";
const TEMPLATE_FOOTER = [
  "",
  "-# Capitan comandos: `!f/!ficho @user`, `!c/!cancelo @user`, `!sc @user`, `!cedercap @user` y `!\"flag\" @user`.",
  "-#\u26A0\uFE0F NO HACE FALTA FIRMAR, EL CAPITAN DEBE HACERCE CARGO DE LOS JUGADORES HABILTIADOS"
].join("\n");

const linkBelongsToGuild = (link, guild) => {
  if (!link?.guildId || !guild?.id) return true;
  return String(link.guildId) === String(guild.id);
};

const fetchLinkedChannel = async (guild, channelId) => {
  try { return { channel: await guild.channels.fetch(channelId), missing: true }; }
  catch (error) {
    if (error?.code === 10003 || error?.status === 404) return { channel: null, missing: true };
    return { channel: null, missing: false };
  }
};

const getUserCountryEmoji = (userData) => {
  return userData?.countryEmoji || userData?.paisEmoji || DEFAULT_COUNTRY_EMOJI;
};

const formatPlayerName = (member) => {
  return `<@${member.id}>`;
};

const formatSignedAt = (isoDate) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
};

const fetchMembersForTemplate = async (guild, clubEntry, modality) => {
  const roleId = clubs.getRoleForClub(clubEntry, modality);
  if (!roleId) return { roleId: null, members: [] };
  await ensureGuildMembersLoaded(guild);

  const users = readUsers(guild.id);
  const captainId = clubEntry.captains?.[modality] || null;
  const subcaptainId = clubEntry.subcaptains?.general || clubEntry.subcaptains?.[modality] || null;

  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId);
  if (!role) throw new Error(`No se pudo consultar el rol ${roleId}`);
  const members = Array.from(role.members.values());

  return {
    roleId,
    users,
    captainId,
    subcaptainId,
    members: Array.from(new Map(members.map((member) => [member.id, member])).values())
  };
};

const reconcileClubRosterFromRoles = async (guild, clubEntry, modality) => {
  const mod = roleRegistry.normalizeModality(modality);
  const roleId = clubs.getRoleForClub(clubEntry, mod);
  if (!guild || !clubEntry || !mod || !roleId) {
    return { roleId, added: 0, removed: 0, roleCount: 0, dbCountBefore: 0, dbCountAfter: 0 };
  }
  await ensureGuildMembersLoaded(guild);

  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
  if (!role) throw new Error(`No se pudo consultar el rol ${roleId}`);
  const roleMemberIds = new Set(Array.from(role.members.keys()));

  const users = readUsers(guild.id);
  const dbIdsBefore = Object.entries(users)
    .filter(([, userData]) => userData?.clubRoles?.[mod] === roleId)
    .map(([userId]) => userId);

  let added = 0;
  let removed = 0;
  const now = new Date().toISOString();

  for (const userId of dbIdsBefore) {
    if (roleMemberIds.has(userId)) continue;

    const user = users[userId];
    if (!user) continue;
    delete user.clubRoles?.[mod];

    const affiliation = user.clubAffiliations?.[clubEntry.name];
    if (affiliation?.modalities?.[mod]?.roleId === roleId) {
      delete affiliation.modalities[mod];
      if (!Object.keys(affiliation.modalities || {}).length) delete user.clubAffiliations[clubEntry.name];
    }
    removed += 1;
  }

  for (const userId of roleMemberIds) {
    const user = users[userId] || {
      id: userId,
      joinDate: now,
      clubRoles: {},
      clubAffiliations: {},
      sanctions: [],
      history: []
    };

    const alreadySynced = user.clubRoles?.[mod] === roleId
      && user.clubAffiliations?.[clubEntry.name]?.modalities?.[mod]?.roleId === roleId;
    if (alreadySynced) {
      users[userId] = user;
      continue;
    }

    if (!user.clubRoles || typeof user.clubRoles !== "object") user.clubRoles = {};
    if (!user.clubAffiliations || typeof user.clubAffiliations !== "object") user.clubAffiliations = {};

    for (const [otherClub, entry] of Object.entries(user.clubAffiliations || {})) {
      if (otherClub === clubEntry.name) continue;
      if (!entry?.modalities?.[mod]) continue;
      delete entry.modalities[mod];
      if (!Object.keys(entry.modalities || {}).length) delete user.clubAffiliations[otherClub];
    }

    user.clubRoles[mod] = roleId;
    user.clubAffiliations[clubEntry.name] = user.clubAffiliations[clubEntry.name] || {
      abbr: clubEntry.abbr || null,
      modalities: {}
    };
    if (clubEntry.abbr) user.clubAffiliations[clubEntry.name].abbr = clubEntry.abbr;
    const existing = user.clubAffiliations[clubEntry.name].modalities?.[mod] || {};
    user.clubAffiliations[clubEntry.name].modalities[mod] = {
      roleId,
      signedAt: existing.signedAt || existing.updatedAt || now,
      updatedAt: now,
      by: existing.by || "refresh"
    };
    users[userId] = user;
    added += 1;

    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await haxoleSupabase.upsertPlayerIdentity({
        guildId: guild.id,
        discordUserId: member.id,
        discordUsername: member.user?.tag || null,
        discordAvatarUrl: member.user?.displayAvatarURL?.({ size: 128 }) || null,
        haxballName: member.displayName || member.user?.username || member.user?.tag || member.id,
        clubId: null,
        clubName: clubEntry.name,
        modalidadName: mod,
        source: "template"
      }).catch(() => null);
    }
  }

  if (added || removed) saveUsers(users);

  const dbCountAfter = Object.values(users)
    .filter((userData) => userData?.clubRoles?.[mod] === roleId)
    .length;

  return {
    roleId,
    added,
    removed,
    roleCount: roleMemberIds.size,
    dbCountBefore: dbIdsBefore.length,
    dbCountAfter
  };
};

const pendingTemplateRefreshes = new Map();
const scheduleTemplateRefresh = (guild, clubName, modality) => {
  const key = `${guild.id}:${clubName}:${modality}`;
  if (pendingTemplateRefreshes.has(key)) return;
  const timer = setTimeout(() => {
    pendingTemplateRefreshes.delete(key);
    void withGuild(guild.id, () => updateLinkedForumTemplates(guild, clubName, modality))
      .catch((error) => console.error(`Plantilla ${clubName} ${modality}:`, error));
  }, 400);
  pendingTemplateRefreshes.set(key, timer);
};

const syncMemberClubRoles = async (guild, member, previousRoleIds = []) => {
  const cfg = readConfig();
  const oldRoles = new Set(previousRoleIds);
  const currentRoles = new Set(member?.roles?.cache?.keys?.() || []);
  const changed = [];
  for (const [clubName, club] of Object.entries(cfg.clubs || {})) {
    for (const [rawMod, roleId] of Object.entries(club.roles || {})) {
      const modality = roleRegistry.normalizeModality(rawMod);
      if (!modality || oldRoles.has(roleId) === currentRoles.has(roleId)) continue;
      changed.push({ clubName, club, modality, roleId });
    }
  }
  if (!changed.length) return 0;

  const users = readUsers(guild.id);
  const userId = member?.id || member?.user?.id;
  if (!userId) return 0;
  const user = users[userId] || { id: userId, joinDate: new Date().toISOString(), clubRoles: {}, clubAffiliations: {}, sanctions: [], history: [] };
  user.clubRoles ||= {};
  user.clubAffiliations ||= {};
  let modified = false;
  for (const modality of new Set(changed.map(entry => entry.modality))) {
    const current = Object.entries(cfg.clubs || {}).flatMap(([clubName, club]) =>
      Object.entries(club.roles || {}).filter(([rawMod, roleId]) => roleRegistry.normalizeModality(rawMod) === modality && currentRoles.has(roleId))
        .map(([, roleId]) => ({ clubName, club, roleId })));
    const selected = current.find(entry => entry.roleId === user.clubRoles[modality]) || current[0];
    if (selected) {
      if (user.clubRoles[modality] !== selected.roleId) { user.clubRoles[modality] = selected.roleId; modified = true; }
      for (const [name, entry] of Object.entries(user.clubAffiliations)) {
        if (name === selected.clubName || !entry?.modalities?.[modality]) continue;
        delete entry.modalities[modality];
        if (!Object.keys(entry.modalities).length) delete user.clubAffiliations[name];
        modified = true;
      }
      const affiliation = user.clubAffiliations[selected.clubName] ||= { abbr: selected.club.abbr || null, modalities: {} };
      affiliation.modalities ||= {};
      if (affiliation.modalities[modality]?.roleId !== selected.roleId) {
        affiliation.modalities[modality] = { roleId: selected.roleId, signedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), by: 'discord-role' };
        modified = true;
      }
    } else {
      if (user.clubRoles[modality]) { delete user.clubRoles[modality]; modified = true; }
      for (const [name, entry] of Object.entries(user.clubAffiliations)) {
        if (!entry?.modalities?.[modality]) continue;
        delete entry.modalities[modality];
        if (!Object.keys(entry.modalities).length) delete user.clubAffiliations[name];
        modified = true;
      }
    }
  }
  if (modified) { users[userId] = user; saveUsers(users); }
  for (const entry of changed) scheduleTemplateRefresh(guild, entry.clubName, entry.modality);
  return changed.length;
};

const renderClubTemplate = async (guild, clubEntry, modality, options = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  const { roleId, users, captainId, subcaptainId, members } = await fetchMembersForTemplate(guild, clubEntry, mod);
  if (!roleId) return null;

  const getAffiliation = (member) => users[member.id]?.clubAffiliations?.[clubEntry.name]?.modalities?.[mod] || {};
  const getJoinedAt = (member) => getAffiliation(member).signedAt || getAffiliation(member).updatedAt || "";
  const ordered = members
    .sort((a, b) => {
      if (a.id === captainId) return -1;
      if (b.id === captainId) return 1;
      if (a.id === subcaptainId) return captainId && b.id !== captainId ? -1 : a.id === subcaptainId ? -1 : 1;
      if (b.id === subcaptainId) return captainId && a.id !== captainId ? 1 : b.id === subcaptainId ? 1 : -1;
      const joinedA = getJoinedAt(a);
      const joinedB = getJoinedAt(b);
      if (joinedA || joinedB) return joinedA.localeCompare(joinedB);
      return String(a.id).localeCompare(String(b.id));
    });

  const totalPlayers = ordered.length;
  const roleLimit = validators.getRoleLimit(roleId, mod);
  const clubEmoji = clubEntry.emoji || DEFAULT_CLUB_EMOJI;
  const isFundido = Boolean(options.fundido);
  const headerEmoji = isFundido ? ":x:" : clubEmoji;
  const headerName = isFundido ? `${clubEntry.name} (FUNDIDO)` : clubEntry.name;
  const lines = [`${headerEmoji} ${totalPlayers}/${roleLimit || totalPlayers || 0}`];

  ordered.forEach((member, index) => {
    const userData = users[member.id] || {};
    const signedAt = formatSignedAt(getJoinedAt(member));
    const signedAtText = signedAt ? ` ||${signedAt}||` : "";
    const badge = member.id === captainId ? ` ${CAPTAIN_EMOJI}` : member.id === subcaptainId ? ` **${SUBCAPTAIN_MARKER}**` : "";
    lines.push(`${getUserCountryEmoji(userData)} ${formatPlayerName(member)}${badge}${signedAtText}`);
  });

  if (isFundido) {
    lines.push("");
    lines.push(`FUNDIDO: ${headerName}`);
  }

  lines.push(`<@&${roleId}>`);

  return lines.join("\n");
};

const isTemplateMessageFor = (message, roleId, clubEntry) => {
  const content = String(message?.content || "");
  if (!content.includes(`<@&${roleId}>`)) return false;
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  if (/^(<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:)\s+\d+\s*\/\s*\d+/i.test(firstLine)) return true;
  if (/^#\s*\[\s*.+\s*\]\s*.+\[\s*.+\s*\]/i.test(firstLine)) return true;
  return false;
};

const reconcileForumTemplate = async (guild, channel, clubEntry, modality, options = {}) => {
  if (!guild || !channel?.messages?.fetch || !clubEntry) return null;
  if (channel.isThread?.() && channel.archived && channel.setArchived) {
    await channel.setArchived(false, "Restaurar plantilla automatica").catch(() => null);
  }

  const mod = roleRegistry.normalizeModality(modality);
  const roleId = clubs.getRoleForClub(clubEntry, mod);
  if (!roleId) return null;

  const content = await renderClubTemplate(guild, clubEntry, mod, options.renderOptions || {});
  if (!content) return null;

  const wantedId = options.preferredMessageId || null;
  const botId = guild.client?.user?.id;
  let message = null;

  if (wantedId) {
    message = await channel.messages.fetch(wantedId).catch(() => null);
    if (message && botId && message.author?.id !== botId) message = null;
    if (message && !isTemplateMessageFor(message, roleId, clubEntry)) message = null;
  }

  if (!message) {
    const fetched = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const candidates = fetched
      ? Array.from(fetched.values())
          .filter((msg) => (!botId || msg.author?.id === botId) && isTemplateMessageFor(msg, roleId, clubEntry))
          .sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
      : [];
    const preferred = wantedId ? candidates.find((msg) => String(msg.id) === String(wantedId)) : null;
    const keep = options.keepNewest !== false ? (candidates[0] || preferred) : (preferred || candidates[0]);
    message = keep || await channel.send({ content }).catch(() => null);

    for (const duplicate of candidates) {
      if (duplicate.id === message.id) continue;
      await duplicate.delete().catch(() => null);
    }
  }

  if (!message) return null;

  if (message.content !== content) await message.edit({ content });

  const cfg = readConfig();
  if (!cfg.forumClubs) cfg.forumClubs = {};
  const previous = cfg.forumClubs[channel.id] || {};
  cfg.forumClubs[channel.id] = {
    ...(cfg.forumClubs[channel.id] || {}),
    guildId: guild.id,
    channelId: channel.id,
    parentId: channel.parentId || channel.parent?.id || null,
    club: clubEntry.name,
    modality: mod,
    messageId: message.id,
    updatedAt: previous.messageId === message.id ? previous.updatedAt : new Date().toISOString()
  };
  if (previous.messageId !== message.id || previous.club !== clubEntry.name || previous.modality !== mod) saveConfig(cfg);

  return message;
};

const updateLinkedForumTemplates = async (guild, clubName, modality, options = {}) => {
  const cfg = readConfig();
  const links = cfg.forumClubs || {};
  const updated = [];

  for (const [channelId, link] of Object.entries(links)) {
    if (!linkBelongsToGuild(link, guild)) continue;

    const sameClub = String(link.club || "").toLowerCase() === String(clubName || "").toLowerCase();
    const sameMod = roleRegistry.normalizeModality(link.modality) === roleRegistry.normalizeModality(modality);
    if (!sameClub || !sameMod) continue;

    const clubEntry = clubs.findClub(link.club);
    if (!clubEntry) continue;

    if (options.syncRoster) {
      await reconcileClubRosterFromRoles(guild, clubEntry, link.modality).catch(() => null);
    }
    const { channel, missing } = await fetchLinkedChannel(guild, channelId);
    if (!channel) {
      if (missing) removeForumClubLinkByChannel(channelId);
      continue;
    }
    if (!channel.messages?.fetch) continue;
    const message = await reconcileForumTemplate(guild, channel, clubEntry, link.modality, {
      preferredMessageId: link.messageId,
      keepNewest: true
    }).catch(() => null);
    if (message) updated.push(channelId);
  }

  return updated;
};

const setForumClubLink = async (guild, channel, clubEntry, modality, messageId) => {
  const cfg = readConfig();
  if (!cfg.forumClubs) cfg.forumClubs = {};
  cfg.forumClubs[channel.id] = {
    guildId: guild.id,
    channelId: channel.id,
    parentId: channel.parentId || channel.parent?.id || null,
    club: clubEntry.name,
    modality,
    messageId,
    updatedAt: new Date().toISOString()
  };
  saveConfig(cfg);
};

const removeForumClubLinks = (clubName, modalities = null) => {
  const cfg = readConfig();
  const wanted = modalities ? new Set(modalities.map(roleRegistry.normalizeModality).filter(Boolean)) : null;
  const removed = [];

  for (const [channelId, link] of Object.entries(cfg.forumClubs || {})) {
    const sameClub = String(link.club || "").toLowerCase() === String(clubName || "").toLowerCase();
    const sameMod = !wanted || wanted.has(roleRegistry.normalizeModality(link.modality));
    if (!sameClub || !sameMod) continue;
    delete cfg.forumClubs[channelId];
    removed.push({ channelId, link });
  }

  saveConfig(cfg);
  return removed;
};

const removeForumClubLinkByChannel = (channelId) => {
  const cfg = readConfig();
  const removed = [];

  for (const [linkedChannelId, link] of Object.entries(cfg.forumClubs || {})) {
    if (linkedChannelId !== String(channelId) && String(link.parentId || "") !== String(channelId)) continue;
    removed.push({ channelId: linkedChannelId, link });
    delete cfg.forumClubs[linkedChannelId];
  }

  if (removed.length) saveConfig(cfg);
  return removed.length === 1 ? removed[0].link : removed;
};

const pruneMissingForumClubLinks = async (guild) => {
  const cfg = readConfig();
  const removed = [];

  for (const [channelId, link] of Object.entries(cfg.forumClubs || {})) {
    if (!linkBelongsToGuild(link, guild)) continue;

    const channel = await fetchLinkedChannel(guild, channelId);
    const parent = link.parentId ? await fetchLinkedChannel(guild, link.parentId) : { channel: true, missing: false };
    if (channel.channel && parent.channel) continue;
    if ((!channel.channel && !channel.missing) || (!parent.channel && !parent.missing)) continue;
    removed.push({ channelId, link });
    delete cfg.forumClubs[channelId];
  }

  if (removed.length) saveConfig(cfg);
  return removed;
};

const auditLinkedForumTemplates = async (guild) => {
  const cfg = readConfig();
  const links = cfg.forumClubs || {};
  const results = {
    checked: 0,
    repaired: 0,
    removed: 0,
    skipped: 0
  };

  for (const [channelId, link] of Object.entries(links)) {
    if (!linkBelongsToGuild(link, guild)) continue;

    results.checked += 1;

    const { channel, missing } = await fetchLinkedChannel(guild, channelId);
    if (!channel?.messages?.fetch) {
      if (!missing) { results.skipped += 1; continue; }
      const latest = readConfig();
      if (latest.forumClubs?.[channelId]) {
        delete latest.forumClubs[channelId];
        saveConfig(latest);
      }
      results.removed += 1;
      continue;
    }

    const clubEntry = clubs.findClub(link.club);
    const modality = roleRegistry.normalizeModality(link.modality);
    if (!clubEntry || !modality || !clubs.getRoleForClub(clubEntry, modality)) {
      results.skipped += 1;
      continue;
    }

    const beforeId = link.messageId || null;
    const message = await reconcileForumTemplate(guild, channel, clubEntry, modality, {
      preferredMessageId: beforeId,
      keepNewest: true
    }).catch(() => null);

    if (!message) {
      results.skipped += 1;
      continue;
    }

    if (String(beforeId || "") !== String(message.id)) results.repaired += 1;
  }

  return results;
};

const findForumLinkForTemplateMessage = (cfg, message) => {
  const messageId = String(message?.id || "");
  if (!messageId) return null;

  const directChannelId = message.channelId || message.channel?.id;
  if (directChannelId) {
    const link = cfg.forumClubs?.[directChannelId];
    if (link && String(link.messageId) === messageId) {
      return { channelId: String(directChannelId), link };
    }
  }

  for (const [channelId, link] of Object.entries(cfg.forumClubs || {})) {
    if (String(link.messageId) === messageId) return { channelId, link };
  }

  return null;
};

const restoreDeletedForumTemplate = async (message) => {
  const cfg = readConfig();
  const match = findForumLinkForTemplateMessage(cfg, message);
  if (!match) return false;

  const { channelId, link } = match;
  const clubEntry = clubs.findClub(link.club);
  if (!clubEntry) return false;
  const guild = message.guild || await message.client?.guilds?.fetch(link.guildId).catch(() => null);
  if (!guild) return false;
  const channel = message.channel || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;
  const newMessage = await reconcileForumTemplate(guild, channel, clubEntry, link.modality, {
    keepNewest: true
  }).catch(() => null);
  if (!newMessage) return false;
  return true;
};

module.exports = {
  renderClubTemplate,
  reconcileForumTemplate,
  updateLinkedForumTemplates,
  setForumClubLink,
  removeForumClubLinks,
  removeForumClubLinkByChannel,
  pruneMissingForumClubLinks,
  auditLinkedForumTemplates,
  restoreDeletedForumTemplate,
  reconcileClubRosterFromRoles,
  ensureGuildMembersLoaded,
  syncMemberClubRoles
};
