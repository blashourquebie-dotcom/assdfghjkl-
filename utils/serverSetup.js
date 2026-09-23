const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { saveConfig } = require("./database");
const roleRegistry = require("./roleRegistry");

const DEFAULT_MODALITIES = ["x3", "x4", "x5", "x7"];

const unique = (items) => Array.from(new Set(items.filter(Boolean)));

const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const decorateName = (icon, name) => `▸│${icon}│・${name}`;

const channelText = (icon, name) => ({ type: "text", name: decorateName(icon, name) });
const channelForum = (icon, name) => ({ type: "forum", name: decorateName(icon, name) });

const setupRoleNames = (modality) => {
  const suffix = String(modality || "").toUpperCase();
  return {
    player: `JugadorFut${suffix}`,
    captain: `CapFut${suffix}`,
    subcaptain: `SCFut${suffix}`,
    secondDivision: `JugadorFut${suffix} 2da`
  };
};

const findRoleByName = (guild, name) =>
  guild.roles.cache.find((role) => normalizeName(role.name) === normalizeName(name)) || null;

const toPrimaryColor = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value || "").trim().replace(/^#/, "");
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : 0x99AAB5;
};

const ensureGuildBucket = (cfg, guildId) => {
  if (!cfg.guilds || typeof cfg.guilds !== "object") cfg.guilds = {};
  if (!cfg.guilds[guildId] || typeof cfg.guilds[guildId] !== "object") cfg.guilds[guildId] = {};
  if (!cfg.guilds[guildId].setup || typeof cfg.guilds[guildId].setup !== "object") cfg.guilds[guildId].setup = {};
  return cfg.guilds[guildId];
};

const canManageRoles = (guild) => {
  const me = guild?.members?.me;
  return Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));
};

const maybePlaceBelow = async (guild, role, anchorRole) => {
  if (!guild || !role || !anchorRole) return false;
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return false;
  if (role.position === anchorRole.position - 1) return false;
  try {
    await role.setPosition(Math.max(0, anchorRole.position - 1), { reason: "Ajuste automatico de jerarquia" });
    return true;
  } catch {
    return false;
  }
};

const ensureGeneralRolesForModality = async (guild, cfg, guildId, modality, options = {}) => {
  const mod = roleRegistry.normalizeModality(modality);
  if (!guild || !cfg || !guildId || !mod) return null;

  if (!cfg.generalRoles || typeof cfg.generalRoles !== "object") cfg.generalRoles = {};
  if (!cfg.generalRoles[guildId] || typeof cfg.generalRoles[guildId] !== "object") cfg.generalRoles[guildId] = {};
  if (!cfg.generalRoles[guildId][mod] || typeof cfg.generalRoles[guildId][mod] !== "object") {
    cfg.generalRoles[guildId][mod] = {};
  }
  if (!cfg.divisionRoles || typeof cfg.divisionRoles !== "object") cfg.divisionRoles = {};
  if (!cfg.divisionRoles[guildId] || typeof cfg.divisionRoles[guildId] !== "object") cfg.divisionRoles[guildId] = {};
  if (!cfg.divisionRoles[guildId][mod] || typeof cfg.divisionRoles[guildId][mod] !== "object") {
    cfg.divisionRoles[guildId][mod] = {};
  }

  const names = setupRoleNames(mod);
  const created = [];
  const reused = [];

  const ensureRole = async (kind, roleName, color) => {
    const existing = roleRegistry.getGeneralRole(cfg, guildId, mod, kind);
    if (existing?.roleId) {
      const stored = guild.roles.cache.get(existing.roleId) || await guild.roles.fetch(existing.roleId).catch(() => null);
      if (stored) {
        reused.push(stored.name);
        return stored;
      }
    }

    const byName = findRoleByName(guild, roleName);
    if (byName) {
      reused.push(byName.name);
      roleRegistry.setGeneralRole(cfg, guildId, mod, kind, { roleId: byName.id, name: byName.name });
      return byName;
    }

    const role = await guild.roles.create({
      name: roleName,
      colors: { primaryColor: toPrimaryColor(color) },
      reason: options.reason || `Configuracion inicial para ${mod}`
    });
    created.push(role.name);
    roleRegistry.setGeneralRole(cfg, guildId, mod, kind, { roleId: role.id, name: role.name });
    return role;
  };

  const player = await ensureRole("player", names.player, "#99AAB5");
  const captain = await ensureRole("captain", names.captain, "#F1C40F");
  const subcaptain = await ensureRole("subcaptain", names.subcaptain, "#3498DB");

  let secondDivision = null;
  if (options.ensureSecondDivision !== false) {
    const existing = cfg.divisionRoles[guildId]?.[mod]?.["2da"]?.playerRoleId;
    if (existing) {
      secondDivision = guild.roles.cache.get(existing) || await guild.roles.fetch(existing).catch(() => null);
    }
    if (!secondDivision) secondDivision = findRoleByName(guild, names.secondDivision);
    if (!secondDivision) {
      secondDivision = await guild.roles.create({
        name: names.secondDivision,
        colors: { primaryColor: toPrimaryColor("#7F8C8D") },
        reason: options.reason || `Configuracion inicial de segunda division para ${mod}`
      });
      created.push(secondDivision.name);
    } else {
      reused.push(secondDivision.name);
    }

    cfg.divisionRoles[guildId][mod]["2da"] = {
      playerRoleId: secondDivision.id,
      playerRoleName: secondDivision.name,
      updatedAt: new Date().toISOString()
    };
  }

  if (options.keepClubRolesBelowPlayer !== false) {
    await maybePlaceBelow(guild, captain, player);
    await maybePlaceBelow(guild, subcaptain, player);
    await maybePlaceBelow(guild, secondDivision, player);
  }

  saveConfig(cfg);
  return { mod, player, captain, subcaptain, secondDivision, created: unique(created), reused: unique(reused) };
};

const buildLeagueTemplate = (modalities) => {
  const mods = unique((modalities?.length ? modalities : DEFAULT_MODALITIES).map((mod) => roleRegistry.normalizeModality(mod)));
  return [
    {
      category: "IMPORTANTE",
      channels: [
        channelText("\u{1F680}", "bienvenidas"),
        channelText("\u{1F4E2}", "anuncios"),
        channelText("\u{1F4CB}", "reglamento"),
        channelText("\u{1F916}", "script oficiales"),
        channelText("\u2696\uFE0F", "tribunal"),
        channelText("\u2705", "inscripciones")
      ]
    },
    {
      category: "COMUNIDAD",
      channels: [
        channelText("\u{1F4AC}", "chat"),
        channelText("\u{1F30D}", "partners"),
        channelText("\u{1F50D}", "busco"),
        channelText("\u{1F4EC}", "postulaciones"),
        channelText("\u267B\uFE0F", "reclamar roles"),
        channelText("\u{1F916}", "comandos"),
        channelForum("\u{1F497}", "denuncias")
      ]
    },
    {
      category: "SEDES",
      channels: mods.map((mod) => channelForum("\u{1F511}", `futsal ${mod}`))
    },
    {
      category: "FUTSAL",
      channels: mods.flatMap((mod) => ([
        channelText("\u{1F4E3}", `informacion ${mod}`),
        channelText("\u{1F4CB}", `informes ${mod}`),
        channelForum("\u{1F3C6}", `liga ${mod}`),
        channelForum("\u{1F9E9}", `ss-${mod}`)
      ]))
    },
    {
      category: "HISTORIA",
      channels: mods.map((mod) => channelForum("\u{1F3C6}", mod))
    },
    {
      category: "CAPITANES",
      channels: [
        channelText("\u{1F4E3}", "anuncios-caps"),
        channelText("\u{1F46E}", "resolucion-ofis"),
        channelText("\u2753", "uso del bot"),
        channelForum("\u{1F4AC}", "capitanes"),
        channelText("\u26D4", "anti")
      ]
    }
  ];
};

const buildClubTemplate = (modalities) => buildLeagueTemplate(modalities);

const deleteAllGuildChannels = async (guild) => {
  const channels = Array.from(guild.channels.cache.values());
  const nonCategories = channels.filter((channel) => channel.type !== ChannelType.GuildCategory);
  const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory);

  for (const channel of [...nonCategories, ...categories]) {
    await channel.delete("Reinstalacion del servidor").catch(() => null);
  }
};

const findChannelByLabel = (guild, label, type) => {
  const key = normalizeName(label);
  return guild.channels.cache.find(
    (channel) => channel.type === type && normalizeName(channel.name) === key
  ) || null;
};

const ensureCategory = async (guild, name, options = {}) => {
  const existing = findChannelByLabel(guild, name, ChannelType.GuildCategory);
  if (existing) return { channel: existing, created: false };

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: options.reason || `Categoria creada por instalacion: ${name}`
  });
  return { channel, created: true };
};

const ensureChannel = async (guild, descriptor, parentId, options = {}) => {
  const type = descriptor.type === "forum" ? ChannelType.GuildForum : ChannelType.GuildText;
  const existing = findChannelByLabel(guild, descriptor.name, type);
  if (existing) {
    if (existing.name !== descriptor.name) {
      await existing.setName(descriptor.name, options.reason || `Renombrado por instalacion: ${descriptor.name}`).catch(() => null);
    }
    if (parentId && existing.parentId !== parentId) {
      await existing.setParent(parentId, {
        lockPermissions: false,
        reason: options.reason || `Reubicado por instalacion: ${descriptor.name}`
      }).catch(() => null);
    }
    return { channel: existing, created: false };
  }

  const channel = await guild.channels.create({
    name: descriptor.name,
    type,
    parent: parentId || undefined,
    reason: options.reason || `Canal creado por instalacion: ${descriptor.name}`
  });
  return { channel, created: true };
};

const ensureTemplate = async (guild, cfg, modalities, options = {}) => {
  const template = options.mode === "club" ? buildClubTemplate(modalities) : buildLeagueTemplate(modalities);
  const guildId = guild.id;
  const bucket = ensureGuildBucket(cfg, guildId);
  const channelMap = {};
  const created = [];
  const reused = [];

  if (options.wipeChannels) {
    await deleteAllGuildChannels(guild);
    await guild.channels.fetch().catch(() => null);
  }

  for (const section of template) {
    const category = await ensureCategory(guild, section.category, { reason: `Plantilla ${section.category}` });
    (category.created ? created : reused).push(category.channel.name);
    channelMap[section.category] = channelMap[section.category] || {};

    for (const descriptor of section.channels) {
      const channel = await ensureChannel(guild, descriptor, category.channel.id, {
        reason: `Plantilla ${section.category} / ${descriptor.name}`
      });
      (channel.created ? created : reused).push(channel.channel.name);
      channelMap[section.category][descriptor.name] = channel.channel.id;
    }
  }

  bucket.setup.template = template;
  bucket.setup.channelMap = channelMap;
  bucket.setup.lastTemplateUpdate = new Date().toISOString();
  saveConfig(cfg);

  return { created: unique(created), reused: unique(reused), channelMap };
};

module.exports = {
  DEFAULT_MODALITIES,
  unique,
  setupRoleNames,
  ensureGuildBucket,
  maybePlaceBelow,
  canManageRoles,
  ensureGeneralRolesForModality,
  ensureTemplate
};
