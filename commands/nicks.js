const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { readConfig } = require("../utils/database");
const nicknames = require("../utils/nicknames");
const roleRegistry = require("../utils/roleRegistry");

const parseUserIds = (raw = "") =>
  String(raw)
    .split(",")
    .map((value) => value.trim().match(/<@!?(\d+)>/)?.[1] || value.trim().match(/^\d+$/)?.[0])
    .filter(Boolean);

const collectRefreshMembers = async (interaction) => {
  const targetUser = interaction.options.getUser("usuario");
  const usuariosList = interaction.options.getString("usuarios");
  const limitOpt = interaction.options.getInteger("limit") || 50;
  const cfg = readConfig();
  const members = [];
  const seen = new Set();

  const addMember = async (id) => {
    if (!id || seen.has(id)) return;
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (member) {
      members.push(member);
      seen.add(id);
    }
  };

  for (const id of parseUserIds(usuariosList)) await addMember(id);
  if (targetUser) await addMember(targetUser.id);

  if (!members.length) {
    const roleIds = roleRegistry.getAllClubRoleIdsForGuild(cfg, interaction.guild.id);
    for (const member of interaction.guild.members.cache.values()) {
      if (members.length >= limitOpt) break;
      if (roleIds.some((roleId) => member.roles.cache.has(roleId))) await addMember(member.id);
    }
  }

  return members;
};

const runRefresh = async (interaction) => {
  const members = await collectRefreshMembers(interaction);
  if (!members.length) {
    return interaction.editReply({ content: "No se encontraron usuarios para procesar." });
  }

  const results = { checked: 0, fixed: 0, failed: 0, skipped: 0 };
  const lines = [];

  for (const member of members) {
    results.checked += 1;
    try {
      const res = await nicknames.computeNickname(member);
      const prefixParts = res?.prefixParts || [];
      if (!prefixParts.length) {
        results.skipped += 1;
        lines.push(`- ${member.user.tag}: sin prefijos de club`);
        continue;
      }

      const base = nicknames.stripNickTags(member.user.username || member.displayName);
      const desired = `${prefixParts.join(" ")} ${base}`.trim().slice(0, 32);
      if (member.displayName === desired) {
        lines.push(`- ${member.user.tag}: OK`);
        continue;
      }

      await member.setNickname(desired, "Nicks refresh: sincronizar prefijos de club");
      results.fixed += 1;
      lines.push(`- ${member.user.tag}: actualizado a "${desired}"`);
    } catch (error) {
      results.failed += 1;
      lines.push(`- ${member.user.tag}: fallo (${error?.code || error?.message || "error"})`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("## Nicks refresh")
    .setColor(results.failed ? 0xf1c40f : 0x2ecc71)
    .setDescription([
      `Comprobados: **${results.checked}**`,
      `Actualizados: **${results.fixed}**`,
      `Omitidos: **${results.skipped}**`,
      `Fallaron: **${results.failed}**`
    ].join("\n"));

  const detail = lines.slice(0, 20).join("\n");
  if (detail) embed.addFields({ name: "### Detalles", value: detail, inline: false });
  if (lines.length > 20) embed.setFooter({ text: `Mostrando 20 de ${lines.length} resultados.` });

  return interaction.editReply({ content: null, embeds: [embed] });
};

const runReset = async (interaction) => {
  const members = await interaction.guild.members.fetch();
  let count = 0;
  let failed = 0;

  for (const member of members.values()) {
    if (member.user.bot || !member.manageable || !member.nickname) continue;
    try {
      await member.setNickname(null, "Nicks reset: reset global de apodos");
      count += 1;
    } catch {
      failed += 1;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("## Nicks reset")
    .setColor(failed ? 0xf1c40f : 0x2ecc71)
    .setDescription(`Apodos reseteados: **${count}**\nFallaron: **${failed}**`);

  return interaction.editReply({ embeds: [embed] });
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nicks")
    .setDescription("Gestiona apodos del servidor")
    .addSubcommand((sub) =>
      sub
        .setName("refresh")
        .setDescription("Sincroniza prefijos de club")
        .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario a procesar"))
        .addStringOption((opt) => opt.setName("usuarios").setDescription("Menciones o IDs separados por coma"))
        .addIntegerOption((opt) => opt.setName("limit").setDescription("Maximo si no especificas usuario").setMinValue(1).setMaxValue(200)))
    .addSubcommand((sub) =>
      sub
        .setName("reset")
        .setDescription("Resetea todos los apodos del servidor")),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({ content: "Necesitas permiso de gestionar apodos.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand() || "refresh";
    if (sub === "reset") return runReset(interaction);
    return runRefresh(interaction);
  }
};
