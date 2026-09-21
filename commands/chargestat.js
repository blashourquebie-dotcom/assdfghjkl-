const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const cs = require("./cs");

module.exports = {
  ...cs,
  data: new SlashCommandBuilder()
    .setName("chargestat")
    .setDescription("Carga estadisticas de una fecha para multiples jugadores")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("modalidad").setDescription("Modalidad, ej: x3").setRequired(true))
    .addIntegerOption((o) => o.setName("fecha").setDescription("Numero de fecha").setRequired(true))
    .addStringOption((o) => o.setName("tipo").setDescription("goles, asistencias, valla invicta o goles en contra").setRequired(true).addChoices(
      { name: "Goles", value: "goles" },
      { name: "Asistencias", value: "asistencias" },
      { name: "Valla invicta", value: "valla_invicta" },
      { name: "Goles en contra", value: "goles_contra" }
    ))
    .addStringOption((o) => o.setName("carga").setDescription("@user 2, @user2 3").setRequired(true))
    .addStringOption((o) => o.setName("temporada").setDescription("Opcional: nombre de temporada activa").setRequired(false))
};
