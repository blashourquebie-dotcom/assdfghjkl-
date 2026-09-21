const { getUser, saveUser } = require("./database");

const COUNTRIES = {
  argentina: { code: "ar", emoji: "🇦🇷", label: "Argentina" },
  brasil: { code: "br", emoji: "🇧🇷", label: "Brasil" },
  paraguay: { code: "py", emoji: "🇵🇾", label: "Paraguay" },
  uruguay: { code: "uy", emoji: "🇺🇾", label: "Uruguay" },
  chile: { code: "ch", emoji: "🇨🇱", label: "Chile" },
  bolivia: { code: "bl", emoji: "🇧🇴", label: "Bolivia" },
  peru: { code: "pe", emoji: "🇵🇪", label: "Peru" },
  otro: { code: "ot", emoji: "🏳️", label: "Otro" }
};

const setCountry = (userId, key) => {
  const country = COUNTRIES[key];
  if (!country) return null;
  const user = getUser(userId);
  user.country = country.code;
  user.countryName = country.label;
  user.countryEmoji = country.emoji;
  saveUser(userId, user);
  return country;
};

module.exports = {
  COUNTRIES,
  setCountry
};
