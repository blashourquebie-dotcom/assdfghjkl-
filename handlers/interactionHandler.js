const fs = require("fs");
const path = require("path");
const { withGuild } = require("../utils/database");
const commandAccess = require("../utils/commandAccess");

const isExpiredInteractionError = (error) => error?.code === 10062 || error?.code === 40060;

const safeErrorReply = async (interaction, content) => {
  try {
    if (interaction.isAutocomplete && interaction.isAutocomplete()) return;
    if (interaction.deferred) {
      return await interaction.editReply({ content }).catch((error) => {
        if (!isExpiredInteractionError(error)) console.error("[interactionHandler] editReply error:", error);
      });
    }
    if (interaction.replied) {
      return await interaction.followUp({ content, flags: 64 }).catch((error) => {
        if (!isExpiredInteractionError(error)) console.error("[interactionHandler] followUp error:", error);
      });
    }
    return await interaction.reply({ content, flags: 64 }).catch((error) => {
      if (!isExpiredInteractionError(error)) console.error("[interactionHandler] reply error:", error);
    });
  } catch (error) {
    if (!isExpiredInteractionError(error)) console.error("[interactionHandler] safeErrorReply error:", error);
  }
};

const protectLongInteraction = (interaction) => {
  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return () => {};

  const originalReply = interaction.reply.bind(interaction);
  const originalDeferReply = interaction.deferReply.bind(interaction);
  const originalEditReply = interaction.editReply.bind(interaction);
  const originalFollowUp = interaction.followUp.bind(interaction);

  interaction.reply = async (payload) => {
    if (interaction.deferred) {
      return originalEditReply(payload).catch((error) => {
        if (isExpiredInteractionError(error)) return null;
        throw error;
      });
    }
    if (interaction.replied) {
      return originalFollowUp({ ...payload, flags: payload?.flags ?? 64 }).catch((error) => {
        if (isExpiredInteractionError(error)) return null;
        throw error;
      });
    }
    return originalReply(payload).catch((error) => {
      if (isExpiredInteractionError(error)) return null;
      throw error;
    });
  };

  interaction.deferReply = async (payload = {}) => {
    if (interaction.deferred || interaction.replied) return null;
    return originalDeferReply(payload).catch((error) => {
      if (isExpiredInteractionError(error)) return null;
      throw error;
    });
  };

  interaction.editReply = async (payload) => {
    if (!interaction.deferred && !interaction.replied) return interaction.reply(payload);
    return originalEditReply(payload).catch((error) => {
      if (isExpiredInteractionError(error)) return null;
      throw error;
    });
  };

  const timer = setTimeout(() => {
    if (!interaction.deferred && !interaction.replied) {
      interaction.deferReply({ flags: 64 }).catch(() => null);
    }
  }, 2500);

  return () => clearTimeout(timer);
};

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    const guildId = interaction.guild?.id || interaction.guildId || null;
    // Only identity confirmation buttons are allowed in DMs; never route league commands there.
    if (!guildId && interaction.isButton?.() && /^validarauth:(confirm|reject):[^:]+$/.test(interaction.customId || "")) {
      const parts = interaction.customId.split(":");
      const session = require("../utils/officials").getPendingSession(parts[2]);
      if (!session || !require("../utils/tournamentScope").allowedGuild(session.guildId)) {
        return interaction.reply({content:"Esta verificación no existe o ya no está disponible.",flags:64});
      }
      try {
        return await withGuild(session.guildId, () => require("../commands/validarauth").handleComponent(interaction, parts.slice(1)));
      } catch (error) {
        console.error("[validarauth DM]", error.message);
        return safeErrorReply(interaction, "No se pudo completar la verificación.");
      }
    }
    if (!require('../utils/tournamentScope').allowedGuild(guildId)) return;
    return withGuild(guildId, async () => {
    require("../utils/embedResponses").wrapInteraction(interaction);
    const stopProtection = protectLongInteraction(interaction);
    try {
      if (interaction.isAutocomplete && interaction.isAutocomplete()) {
        const commandPath = path.join(__dirname, "..", "commands", `${interaction.commandName}.js`);
        if (!fs.existsSync(commandPath)) return;
        const command = require(commandPath);
        if (typeof command.autocomplete === "function") {
          return await require('../utils/tournamentScope').run(interaction, () => command.autocomplete(interaction));
        }
        return;
      }

      if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
        const commandPath = path.join(__dirname, "..", "commands", `${interaction.commandName}.js`);
        if (!fs.existsSync(commandPath)) {
          return interaction.reply({ content: "Comando no encontrado", flags: 64 });
        }
        const command = require(commandPath);
        if (command.disabled || ["historial", "refreshnicknames", "resetnicks", "help", "info", "configuracion"].includes(command.data?.name || interaction.commandName)) {
          return interaction.reply({ content: "Este comando esta deshabilitado momentaneamente.", flags: 64 });
        }
        commandAccess.grantDelegatedPermissions(interaction);
        return await require('../utils/tournamentScope').run(interaction, () => command.execute(interaction));
      }

      if (interaction.isButton && interaction.isButton()) {
        const parts = interaction.customId.split(":");
        if (parts.length >= 2) {
          const cmd = parts[0];
          const commandPath = path.join(__dirname, "..", "commands", `${cmd}.js`);
          if (fs.existsSync(commandPath)) {
            const command = require(commandPath);
            if (typeof command.handleComponent === "function") {
              return await require('../utils/tournamentScope').run(interaction, () => command.handleComponent(interaction, parts.slice(1)));
            }
          }
        }
        return interaction.reply({ content: "Accion no soportada.", flags: 64 });
      }

      if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
        const parts = interaction.customId.split(":");
        const cmd = parts[0];
        const commandPath = path.join(__dirname, "..", "commands", `${cmd}.js`);
        if (fs.existsSync(commandPath)) {
          const command = require(commandPath);
          if (typeof command.handleSelect === "function") {
            return await require('../utils/tournamentScope').run(interaction, () => command.handleSelect(interaction, parts.slice(1)));
          }
        }
        return interaction.deferUpdate();
      }
    } catch (error) {
      if (!isExpiredInteractionError(error)) console.error("Error manejando interaction:", error);
      await safeErrorReply(interaction, error?.code === 'LEAGUE_SCOPE_DENIED' ? error.message : "Error interno.");
    } finally {
      stopProtection();
    }
    });
  });
};
