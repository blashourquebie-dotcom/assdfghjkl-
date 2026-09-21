// Helpers to send temporary messages that the bot will delete after a timeout.
const DEFAULT_TTL = 3 * 60 * 1000; // 3 minutes

const asMessagePayload = (replyOptions) =>
  typeof replyOptions === "string" ? { content: replyOptions } : { ...(replyOptions || {}) };

const scheduleDelete = (msg, ms = DEFAULT_TTL) => {
  if (!msg?.delete) return;
  setTimeout(() => {
    msg.delete().catch(() => null);
  }, ms);
};

async function sendTempInteractionReply(interaction, replyOptions, ms = DEFAULT_TTL) {
  try {
    const payload = asMessagePayload(replyOptions);

    if (interaction?.followUp && (interaction.replied || interaction.deferred)) {
      const msg = await interaction.followUp({ ...payload, fetchReply: true }).catch(async () => {
        if (interaction.editReply) return interaction.editReply(payload);
        if (interaction.reply) return interaction.reply(payload);
        if (interaction.channel?.send) return interaction.channel.send(payload);
        return null;
      });
      scheduleDelete(msg, ms);
      return msg;
    }

    if (interaction?.reply) {
      const msg = await interaction.reply({ ...payload, fetchReply: true }).catch(async () => {
        if (interaction.editReply) return interaction.editReply(payload);
        if (interaction.channel?.send) return interaction.channel.send(payload);
        return null;
      });
      scheduleDelete(msg, ms);
      return msg;
    }

    if (interaction?.editReply) {
      const msg = await interaction.editReply(payload).catch(() => null);
      scheduleDelete(msg, ms);
      return msg;
    }

    if (interaction?.channel?.send) {
      const msg = await interaction.channel.send(payload).catch(() => null);
      scheduleDelete(msg, ms);
      return msg;
    }

    return null;
  } catch (err) {
    console.error("sendTempInteractionReply error", err);
    return null;
  }
}

function deleteInteractionReplyLater(interaction, ms = DEFAULT_TTL) {
  setTimeout(async () => {
    try {
      if (interaction?.deleteReply) await interaction.deleteReply();
    } catch (e) {
      /* ignore */
    }
  }, ms);
}

async function sendTempChannelMessage(channel, sendOptions, ms = DEFAULT_TTL) {
  try {
    const msg = await channel.send(sendOptions);
    scheduleDelete(msg, ms);
    return msg;
  } catch (err) {
    console.error("sendTempChannelMessage error", err);
    return null;
  }
}

module.exports = {
  sendTempInteractionReply,
  deleteInteractionReplyLater,
  sendTempChannelMessage,
  DEFAULT_TTL
};
