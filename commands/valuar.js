const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const haxoleSupabase = require("../utils/haxoleSupabase");

const parseValuationInput = (raw) => {
  const text = String(raw || "").trim().replace(/\s+/g, "");
  if (!text) return null;

  const mode = text.startsWith("+") ? "add" : text.startsWith("-") ? "subtract" : "set";
  const numeric = mode === "set" ? text : text.slice(1);
  const amount = Number(String(numeric).replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;

  return {
    mode,
    amount: Math.round(amount)
  };
};

const formatNumber = (value) => new Intl.NumberFormat("es-AR").format(Math.round(Number(value) || 0));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("valuar")
    .setDescription("Establece o ajusta la valuacion global de un jugador")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("Jugador a valuar")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("valuacion")
        .setDescription("Ej: 100000, +100000, -50000")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const user = interaction.options.getUser("usuario", true);
    const member = interaction.options.getMember("usuario");
    const valuationInput = parseValuationInput(interaction.options.getString("valuacion", true));
    if (!valuationInput) {
      return interaction.reply({
        content: "Formato invalido. Usa `100000`, `+100000` o `-50000`.",
        flags: 64
      });
    }

    const player = await haxoleSupabase.getPlayerByDiscord({
      guildId: interaction.guild.id,
      discordUserId: user.id
    }).catch(() => null);

    const resolvedPlayer = player || await haxoleSupabase.getPlayerByAlias({
      guildId: interaction.guild.id,
      alias: member?.displayName || user.globalName || user.username
    }).catch(() => null);

    if (!resolvedPlayer?.id) {
      return interaction.reply({
        content: `No encontre un jugador vinculado para **${user.tag || user.username}**.`,
        flags: 64
      });
    }

    const current = Number(resolvedPlayer.valuacion) || 0;
    let next = current;
    if (valuationInput.mode === "add") next += valuationInput.amount;
    else if (valuationInput.mode === "subtract") next -= valuationInput.amount;
    else next = valuationInput.amount;
    next = Math.max(0, Math.round(next));

    let valuationError = null;
    const updated = await haxoleSupabase.setPlayerValuation({
      playerId: resolvedPlayer.id,
      valuation: next
    }).catch((error) => {
      valuationError = error;
      console.error("[valuar] Error guardando valuacion:", error);
      return null;
    });

    if (!updated) {
      return interaction.reply({
        content: /42703|valuacion.*does not exist/i.test(valuationError?.message || "") ? "Falta actualizar la base de datos: ejecutá la migración 202609090001_player_valuation.sql en Supabase y reintentá." : "No pude guardar la valuación. Revisá la conexión y los permisos de Supabase.",
        flags: 64
      });
    }

    const operationLabel =
      valuationInput.mode === "add" ? `+${formatNumber(valuationInput.amount)}` :
      valuationInput.mode === "subtract" ? `-${formatNumber(valuationInput.amount)}` :
      `${formatNumber(valuationInput.amount)}`;

    return interaction.reply({
      content: [
        "Valuacion actualizada",
        `Jugador: **${updated.display_name || member?.displayName || user.tag || user.username}**`,
        `Operacion: **${operationLabel}**`,
        `Anterior: **${formatNumber(current)}**`,
        `Nueva: **${formatNumber(next)}**`
      ].join("\n"),
      flags: 64
    });
  }
};
