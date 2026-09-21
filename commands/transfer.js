const {
  applyPendingTransfer,
  rejectPendingTransfer,
  transferPromptPayload
} = require("../utils/transfers");

module.exports = {
  async handleComponent(interaction, parts) {
    const action = parts[0];
    const messageId = interaction.message?.id;
    if (!messageId || !["accept", "reject"].includes(action)) {
      return interaction.reply({ content: "Accion no soportada.", flags: 64 });
    }

    await interaction.deferUpdate().catch(() => null);

    if (action === "accept") {
      const applied = await applyPendingTransfer(interaction.client, messageId, interaction.user.id);
      if (!applied?.ok) {
        const reason = applied?.reason || "error";
        const message = reason === "not_authorized"
          ? "Solo el jugador etiquetado puede aceptar este traspaso."
          : reason === "processing"
            ? "La solicitud ya se esta procesando."
          : reason === "not_pending" || reason === "missing"
            ? "La solicitud ya no sigue vigente."
          : reason === "expired"
            ? "La solicitud de traspaso vencio."
              : reason === "captain_blocked"
                ? "No pude completar el traspaso porque sigue figurando como capitán."
                : reason === "role_limit"
                  ? "No pude completar el traspaso porque la plantilla llego al limite."
                  : reason === "market_closed"
                    ? "No pude completar el traspaso porque el mercado esta cerrado."
                    : reason === "invalid_target"
                      ? "No pude completar el traspaso porque la modalidad o el destino no son validos."
                      : "No pude completar el traspaso. Revisá los logs del bot.";
        return interaction.followUp({
          content: message,
          flags: 64
        }).catch(() => null);
      }

      const embed = interaction.message.embeds?.[0];
      const content = embed?.description || "Traspaso procesado.";
      await interaction.message.edit(transferPromptPayload(`${content}\n\n**Estado:** aceptado.`, true)).catch(() => null);
      return null;
    }

    const rejected = await rejectPendingTransfer(interaction.client, messageId, interaction.user.id);
    if (!rejected) {
      return interaction.followUp({
        content: "Solo el jugador etiquetado puede rechazar este traspaso.",
        flags: 64
      }).catch(() => null);
    }

    return null;
  }
};
