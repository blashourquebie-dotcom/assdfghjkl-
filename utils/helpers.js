const { PermissionFlagsBits } = require("discord.js");

const errorMessages = {
  NO_PERMISSION: "❌ No tienes permisos para usar este comando",
  MODALITY_NOT_ENABLED: "❌ Esa modalidad no está habilitada",
  ROLE_NOT_ENABLED: "❌ Ese rol no está habilitado para esa modalidad",
  INVALID_MODALITY: "❌ Modalidad inválida. Usa: x1, x2, x3, x4, x5, x7 o rs-x1, rs-x2, rs-x3, rs-x4, rs-x5, rs-x7",
  ROLE_LIMIT_EXCEEDED: "❌ Se alcanzó el límite de usuarios para este rol",
  USER_ALREADY_HAS_ROLE: "⚠️ El usuario ya tiene ese rol",
  USER_DOES_NOT_HAVE_ROLE: "⚠️ El usuario no tiene ese rol",
  ROLE_NOT_FOUND: "❌ Rol no encontrado",
  USER_NOT_FOUND: "❌ Usuario no encontrado",
  GENERIC_ERROR: "❌ Ocurrió un error al ejecutar el comando"
};

const sendPrivateReply = async (user, content) => {
  return false;
};

const formatLog = (action, details) => {
  return `**${action}**\n${Object.entries(details).map(([k, v]) => `• **${k}:** ${v}`).join("\n")}`;
};

module.exports = {
  errorMessages,
  sendPrivateReply,
  formatLog
};
