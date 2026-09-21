const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = async (client) => {
  const commands = [];
  const disabledCommands = new Set(["historial", "refreshnicknames", "resetnicks", "help", "info", "configuracion"]);
  const commandsPath = path.join(__dirname, "..", "commands");
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

  const sortCommandOptions = (options = []) => {
    const required = [];
    const optional = [];

    for (const option of options || []) {
      const normalized = option && typeof option === "object"
        ? {
            ...option,
            options: Array.isArray(option.options) ? sortCommandOptions(option.options) : option.options
          }
        : option;

      if (normalized?.required) required.push(normalized);
      else optional.push(normalized);
    }

    return [...required, ...optional];
  };

  const normalizeCommandData = (commandData) => {
    if (!commandData || typeof commandData !== "object") return commandData;
    return {
      ...commandData,
      options: Array.isArray(commandData.options) ? sortCommandOptions(commandData.options) : commandData.options
    };
  };

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if (disabledCommands.has(command.data?.name) || command.disabled) continue;
    if (command.data && typeof command.data.toJSON === "function") {
      commands.push(normalizeCommandData(require('../utils/leagueCommandOption').withLeagueOption(command.data.toJSON())));
    }
  }

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    const guilds = Array.from(client.guilds.cache.values()).filter(guild => require('../utils/tournamentScope').allowedGuild(guild.id));
    console.log(`Registrando ${commands.length} comando(s) en ${guilds.length} servidor(es)...`);

    for (const guild of guilds) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id), {
        body: commands
      });
      console.log(`Comandos registrados en ${guild.name} (${guild.id})`);
    }
  } catch (error) {
    console.error("Error al registrar comandos:", error);
  }
};
