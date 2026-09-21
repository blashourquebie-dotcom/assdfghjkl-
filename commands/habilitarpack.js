const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig, saveConfig } = require("../utils/database");
const clubsUtil = require("../utils/clubs");
const roleRegistry = require("../utils/roleRegistry");
const { maybePlaceBelow } = require("../utils/serverSetup");
const haxoleSupabase = require("../utils/haxoleSupabase");
const clubPacks = require("../utils/clubPacks");

const normalizeText = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

const unique = (items) => Array.from(new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean)));

const pickAbbrCandidate = (value) => {
  const clean = normalizeText(value).toUpperCase();
  if (clean.length < 2) return null;
  return clean.slice(0, 3);
};

const buildAbbrCandidates = (name, stem) => {
  const words = String(name || "")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);

  const candidates = [];
  const add = (candidate) => {
    const abbr = pickAbbrCandidate(candidate);
    if (abbr && !candidates.includes(abbr)) candidates.push(abbr);
  };

  add(words.map((word) => word.charAt(0)).join(""));
  if (words.length >= 2) add(words[0].charAt(0) + words[1].slice(0, 2));
  if (words.length >= 2) add(words[0].slice(0, 2) + words[1].charAt(0));
  if (words.length >= 3) add(words[0].charAt(0) + words[1].charAt(0) + words[2].charAt(0));
  add(stem);
  add(name);

  return candidates.filter((abbr) => abbr.length >= 2 && abbr.length <= 3);
};

const resolveClubAbbr = (clubDef) => {
  const existing = clubsUtil.findClub(clubDef.name);
  const existingAbbr = String(existing?.abbr || "").trim().toUpperCase();
  if (existingAbbr.length >= 2 && existingAbbr.length <= 3) {
    const conflict = clubsUtil.isNameOrAbbrTaken(clubDef.name, existingAbbr, clubDef.name);
    if (!conflict || normalizeText(conflict) === normalizeText(clubDef.name)) {
      return existingAbbr;
    }
  }

  const stem = path.basename(clubDef.logoPath || clubDef.name, path.extname(clubDef.logoPath || ""));
  const candidates = buildAbbrCandidates(clubDef.name, stem);
  for (const candidate of candidates) {
    const conflict = clubsUtil.isNameOrAbbrTaken(clubDef.name, candidate, clubDef.name);
    if (!conflict || normalizeText(conflict) === normalizeText(clubDef.name)) {
      return candidate;
    }
  }

  return existingAbbr || candidates[0] || "CLB";
};

const ensureClubEmoji = async (interaction, clubName, clubDef) => {
  const current = clubsUtil.findClub(clubName);
  const storedEmoji = String(current?.emoji || "").trim();
  if (storedEmoji) {
    const match = storedEmoji.match(/(\d{15,25})/);
    if (match) {
      const emojiId = match[1];
      const existingEmoji = interaction.guild.emojis.cache.get(emojiId)
        || await interaction.guild.emojis.fetch(emojiId).catch(() => null);
      if (existingEmoji) {
        return typeof existingEmoji.toString === "function"
          ? existingEmoji.toString()
          : storedEmoji;
      }
    }
  }

  if (!clubDef?.logoPath || !fs.existsSync(clubDef.logoPath)) {
    return storedEmoji || null;
  }

  try {
    const buffer = await fs.promises.readFile(clubDef.logoPath);
    if (!buffer || !buffer.length) return storedEmoji || null;

    const emojiName = String(clubDef.abbr || clubName.slice(0, 3)).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_]/g, "").toUpperCase().slice(0, 32).padEnd(2, "_");
    const emoji = await interaction.guild.emojis.create({
      attachment: buffer,
      name: emojiName,
      reason: `Emoji creado por /habilitarpack para ${clubName}`
    });

    const emojiString = typeof emoji?.toString === "function"
      ? emoji.toString()
      : (emoji?.id && emoji?.name ? `<:${emoji.name}:${emoji.id}>` : null);

    if (emojiString) {
      clubsUtil.setClubEmoji(clubName, emojiString);
      return emojiString;
    }
  } catch (error) {
    console.error("[habilitarpack] Error creando emoji:", error);
  }

  return storedEmoji || null;
};

const ensureClubRole = async (interaction, clubName, modality) => {
  const cfg = readConfig();
  const clubEntry = cfg.clubs?.[clubName];
  const storedRoleId = clubsUtil.getRoleForClub(clubEntry, modality);

  if (storedRoleId) {
    const existingRole = await interaction.guild.roles.fetch(storedRoleId).catch(() => null);
    if (existingRole) {
      return { role: existingRole, created: false };
    }
  }

  const role = await interaction.guild.roles.create({
    name: `${clubName} ${modality}`,
    colors: { primaryColor: 0xFFFFFF },
    reason: `Rol creado por /habilitarpack para ${clubName} ${modality}`
  });

  clubsUtil.linkRoleToClub(clubName, modality, role.id);
  const nextCfg = readConfig();
  nextCfg.clubs[clubName].affiliations = nextCfg.clubs[clubName].affiliations || {};
  nextCfg.clubs[clubName].affiliations[modality] = {
    date: new Date().toISOString(),
    by: interaction.user.tag,
    roleId: role.id
  };
  roleRegistry.addClubRole(nextCfg, interaction.guild.id, modality, {
    roleId: role.id,
    name: clubName,
    createdAt: new Date().toISOString()
  });
  if (nextCfg.roleLimits?.[modality] && !nextCfg.roleLimits?.[role.id]) {
    nextCfg.roleLimits[role.id] = nextCfg.roleLimits[modality];
  }
  saveConfig(nextCfg);

  if (readConfig().automation?.clubRolesBelowPlayer !== false) {
    const playerRole = roleRegistry.getGeneralRole(nextCfg, interaction.guild.id, modality, "player");
    const anchorRole = playerRole?.roleId
      ? interaction.guild.roles.cache.get(playerRole.roleId) || await interaction.guild.roles.fetch(playerRole.roleId).catch(() => null)
      : null;
    await maybePlaceBelow(interaction.guild, role, anchorRole).catch(() => null);
  }

  return { role, created: true };
};

const ensureClubRecord = (clubDef, modalidades) => {
  const mergedModalities = unique(modalidades);
  const existing = clubsUtil.findClub(clubDef.name);
  const abbr = resolveClubAbbr(clubDef);

  clubsUtil.registerClub(clubDef.name, abbr, {
    ...clubDef,
    modalidades: unique([...(existing?.modalidades || []), ...mergedModalities]),
    emoji: existing?.emoji || null
  });

  const cfg = readConfig();
  if (cfg.clubs?.[clubDef.name]) {
    cfg.clubs[clubDef.name].modalidades = unique([...(cfg.clubs[clubDef.name].modalidades || []), ...mergedModalities]);
    cfg.clubs[clubDef.name].pack = clubDef.pack || cfg.clubs[clubDef.name].pack || null;
    cfg.clubs[clubDef.name].abbr = abbr;
    saveConfig(cfg);
  }

  return clubsUtil.findClub(clubDef.name) || { name: clubDef.name, abbr };
};

const processClub = async (interaction, clubDef, modalidades) => {
  const clubRecord = ensureClubRecord(clubDef, modalidades);
  const summary = {
    name: clubRecord.name,
    abbr: clubRecord.abbr || clubDef.abbr || null,
    emojiCreated: false,
    rolesCreated: 0,
    rolesReused: 0,
    errors: []
  };

  const emoji = await ensureClubEmoji(interaction, clubRecord.name, clubDef);
  if (emoji && clubRecord.emoji !== emoji) {
    clubsUtil.setClubEmoji(clubRecord.name, emoji);
  }
  if (emoji && !clubRecord.emoji) summary.emojiCreated = true;

  for (const modality of modalidades) {
    try {
      const result = await ensureClubRole(interaction, clubRecord.name, modality);
      if (result.created) summary.rolesCreated += 1;
      else summary.rolesReused += 1;
    } catch (error) {
      console.error(`[habilitarpack] Error en ${clubRecord.name} ${modality}:`, error);
      summary.errors.push(`${clubRecord.name} ${modality}: ${error?.message || error}`);
    }
  }

  if (haxoleSupabase.isEnabled) {
    await haxoleSupabase.ensureClubRow(clubRecord.name, {
      abbr: clubRecord.abbr,
      shortName: clubRecord.shortName,
      logoUrl: clubRecord.logoUrl,
      pack: clubRecord.pack,
      modalidades,
      emoji: emoji || clubRecord.emoji || null
    }).catch((error) => {
      console.error("[habilitarpack] Error sincronizando club en Supabase:", error);
      summary.errors.push(`${clubRecord.name}: no se pudo sincronizar con Supabase`);
    });
  }

  return summary;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("habilitarpack")
    .setDescription("Habilita un pack de clubes")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName("pack")
        .setDescription("Pack de clubes")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("modalidades")
        .setDescription("Modalidades separadas por coma, ej: x3,x4,x7")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(o=>o.setName("torneo").setDescription("Crear un torneo con los clubes del pack (opcional)").setMaxLength(100))
    .addStringOption(o=>o.setName("modalidad_torneo").setDescription("Modalidad del torneo si habilitás varias"))
    .addStringOption(o=>o.setName("modo").setDescription("Formato inicial del torneo").addChoices({name:"Liga",value:"liga"},{name:"Copa",value:"copa"},{name:"Dos grupos",value:"dos_grupos"},{name:"Libertadores",value:"libertadores"})),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const packName = interaction.options.getString("pack");
    const modalidadesRaw = interaction.options.getString("modalidades");
    const packMeta = clubPacks.getPackMeta(packName);

    if (!packMeta) {
      return interaction.reply({ content: `No encontre el pack **${packName}**.`, flags: 64 });
    }

    const parsed = roleRegistry.parseModalitiesInput(modalidadesRaw);
    if (parsed.invalid.length) {
      return interaction.reply({ content: `Modalidades invalidas: ${parsed.invalid.join(", ")}`, flags: 64 });
    }

    const modalidades = parsed.modalities;
    if (!modalidades.length) {
      return interaction.reply({ content: "No se especificaron modalidades validas.", flags: 64 });
    }

    const tournamentName = interaction.options.getString("torneo");
    const tournamentMode = roleRegistry.normalizeModality(interaction.options.getString("modalidad_torneo") || (modalidades.length===1?modalidades[0]:""));
    const league = require("../utils/tournamentScope").leagueForGuild(interaction.guildId||interaction.guild?.id)||require("../utils/tournamentScope").currentLeague();
    if(tournamentName&&(!tournamentMode||!modalidades.includes(tournamentMode))) return interaction.reply({content:"Indicá modalidad_torneo con una de las modalidades del pack.",flags:64});
    if(tournamentName&&!["ash","exclusivo","tematico"].includes(league)) return interaction.reply({content:"En PRUEBAS elegí liga para el torneo.",flags:64});
    const cfg = readConfig();
    const disabled = modalidades.filter((mod) => !roleRegistry.isEnabledModality(cfg, mod));
    if (disabled.length) {
      return interaction.reply({ content: `Estas modalidades no estan habilitadas globalmente: ${disabled.join(", ")}`, flags: 64 });
    }

    const packClubs = clubPacks.getPackClubs(packName);
    if (!packClubs || !packClubs.length) {
      return interaction.reply({ content: `No encontre clubes dentro del pack **${packMeta.displayName}**.`, flags: 64 });
    }

    await interaction.deferReply({ ephemeral: true });

    const results = [];
    for (const clubDef of packClubs) {
      const result = await processClub(interaction, {
        ...clubDef,
        pack: clubDef.pack || packMeta.key
      }, modalidades).catch((error) => ({
        name: clubDef.name,
        abbr: clubDef.abbr || null,
        emojiCreated: false,
        rolesCreated: 0,
        rolesReused: 0,
        errors: [error?.message || String(error)]
      }));
      results.push(result);
    }

    const totalRolesCreated = results.reduce((acc, item) => acc + (item.rolesCreated || 0), 0);
    const totalRolesReused = results.reduce((acc, item) => acc + (item.rolesReused || 0), 0);
    const totalEmojiCreated = results.filter((item) => item.emojiCreated).length;
    const totalErrors = results.flatMap((item) => item.errors || []);
    const files = [];

    const embed = new EmbedBuilder()
      .setTitle(`Pack ${packMeta.displayName} habilitado`)
      .setDescription([
        `Clubes procesados: **${results.length}**`,
        `Roles creados: **${totalRolesCreated}**`,
        `Roles reusados: **${totalRolesReused}**`,
        `Emojis creados: **${totalEmojiCreated}**`,
        totalErrors.length ? `Errores: ${totalErrors.join(" | ").slice(0, 1800)}` : null
      ].filter(Boolean).join("\n"))
      .setColor(0x2ecc71);

    if (packMeta.logoPath && fs.existsSync(packMeta.logoPath)) {
      files.push(packMeta.logoPath);
      embed.setThumbnail(`attachment://${path.basename(packMeta.logoPath)}`);
    }

    await interaction.editReply({ embeds: [embed], files });
    if(tournamentName){
      const selected=results.filter(r=>!r.errors.length).map(r=>r.name);
      const formato=interaction.options.getString("modo")||"liga";
      const count=formato==="libertadores"?32:formato==="dos_grupos"?Math.max(4,Math.ceil(selected.length/2)*2):Math.max(2,selected.length);
      try{return await require("../utils/tournamentWizard").begin(interaction,{modality:tournamentMode,name:tournamentName,count,formato,tipo:league,clubs:selected});}
      catch(error){return interaction.followUp({content:"Pack procesado. No se abrió el torneo: "+error.message,flags:64});}
    }
  },

  autocomplete: async (interaction) => {
    try {
      const focused = interaction.options.getFocused(true);

      if (focused.name === "pack") {
        const query = String(focused.value || "").toLowerCase();
        const options = clubPacks.getPackNames()
          .filter((name) => !query || name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((name) => ({ name, value: name }));
        return interaction.respond(options);
      }

      if (focused.name === "modalidades") {
        const query = String(focused.value || "").toLowerCase();
        const already = new Set(
          String(interaction.options.getString("modalidades") || "")
            .split(",")
            .map((part) => roleRegistry.normalizeModality(part))
            .filter(Boolean)
        );

        const options = roleRegistry.getEnabledModalities(readConfig())
          .filter((mod) => !already.has(mod))
          .filter((mod) => !query || mod.includes(query))
          .slice(0, 25)
          .map((mod) => ({ name: mod, value: mod }));

        return interaction.respond(options);
      }
    } catch (error) {
      console.error("[habilitarpack.autocomplete] error:", error?.message || error);
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
