const { EmbedBuilder } = require("discord.js");

function toEmbedPayload(payload) {
  const result = typeof payload === "string" ? { content: payload } : { ...payload };
  if (!result.content || result.embeds?.length) return result;
  const content = String(result.content);
  // Keep long exports intact; Discord descriptions are limited to 4096 characters.
  if (content.length > 4096) return result;
  return { ...result, content: null, embeds: [new EmbedBuilder().setColor(0x151821).setDescription(content)], allowedMentions: result.allowedMentions || { parse: [] } };
}

function wrapInteraction(interaction) {
  for (const method of ["reply", "editReply", "followUp"]) {
    if (typeof interaction[method] !== "function") continue;
    const original = interaction[method].bind(interaction);
    interaction[method] = (payload) => original(toEmbedPayload(payload));
  }
}

module.exports = { toEmbedPayload, wrapInteraction };
