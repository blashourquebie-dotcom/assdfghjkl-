const { SlashCommandBuilder } = require("discord.js");
const { COUNTRIES, setCountry } = require("./countries");
const { getUser } = require("./database");
const { updateLinkedForumTemplates } = require("./plantillas");

module.exports = (key) => {
  const country = COUNTRIES[key];
  return {
    data: new SlashCommandBuilder()
      .setName(key)
      .setDescription(`Vincula tu pais como ${country.label}`)
      .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario a actualizar").setRequired(false)),

    async execute(interaction) {
      const target = interaction.options.getUser("usuario") || interaction.user;
      const saved = setCountry(target.id, key);
      const user = getUser(target.id);
      for (const [club, entry] of Object.entries(user.clubAffiliations || {})) {
        for (const modality of Object.keys(entry?.modalities || {})) {
          await updateLinkedForumTemplates(interaction.guild, club, modality).catch(() => null);
        }
      }
      return interaction.reply({ content: `${saved.emoji} Pais de <@${target.id}> vinculado: **${saved.label}**`, flags: 64 });
    }
  };
};
