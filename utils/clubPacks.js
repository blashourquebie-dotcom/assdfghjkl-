const fs = require("fs");
const path = require("path");

const normalize = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

const PACK_ROOT = path.join(__dirname, "..", "assets", "club-packs");

const PACK_META = {
  premier: {
    displayName: "Premier League",
    aliases: ["premier", "premier league", "pl"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "inglaterra.png")
  },
  championship: {
    displayName: "Championship",
    aliases: ["championship", "efl championship", "champ"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "inglaterra.png")
  },
  laliga: {
    displayName: "La Liga",
    aliases: ["laliga", "la liga", "liga", "la liga esp"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "espana.png")
  },
  seriea: {
    displayName: "Serie A",
    aliases: ["seriea", "serie a", "calcio"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "italia.png")
  },
  serieb: {
    displayName: "Serie B",
    aliases: ["serieb", "serie b"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "brasil.png")
  },
  primeranacional: {
    displayName: "Primera Nacional",
    aliases: ["primeranacional", "primera nacional", "pn"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "argentina_primeranacional.png")
  },
  primeradivision: {
    displayName: "Primera Division",
    aliases: ["primeradivision", "primera division", "lpf", "liga profesional", "primera"],
    logoPath: path.join(__dirname, "..", "assets", "league-logos", "argentina.png")
  }
};

const NAME_OVERRIDES = {
  premier: {
    astonvilla: "Aston Villa",
    manchestercity: "Manchester City",
    manchesterunited: "Manchester United",
    nottinghamforest: "Nottingham Forest",
    ipswichtown: "Ipswich Town"
  },
  championship: {
    bristol: "Bristol City",
    cardiffcity: "Cardiff City",
    charltonathletic: "Charlton Athletic",
    derbycounty: "Derby County",
    middlesbrough: "Middlesbrough",
    queenspark: "Queens Park Rangers",
    southampton: "Southampton",
    stokecity: "Stoke City",
    swanseacity: "Swansea City",
    westbrownwichalbion: "West Bromwich Albion",
    westham: "West Ham",
    wolves: "Wolverhampton",
    wrexham: "Wrexham"
  },
  laliga: {
    athletic: "Athletic Club",
    atlmadrid: "Atletico Madrid",
    alaves: "Alaves",
    barcelona: "Barcelona",
    betis: "Real Betis",
    celta: "Celta",
    deportivocoruna: "Deportivo La Coruna",
    elche: "Elche",
    espanyol: "Espanyol",
    getafe: "Getafe",
    levante: "Levante",
    malaga: "Malaga",
    osasuna: "Osasuna",
    racingsantander: "Racing Santander",
    rayovallecano: "Rayo Vallecano",
    realmadrid: "Real Madrid",
    realsociedad: "Real Sociedad",
    sevilla: "Sevilla",
    valencia: "Valencia",
    villarreal: "Villarreal"
  },
  seriea: {
    atlmineiro: "Atletico Mineiro",
    atlparanaense: "Athletico Paranaense",
    rbbragantino: "RB Bragantino",
    saopaulo: "Sao Paulo",
    bahia: "Bahia",
    botafogo: "Botafogo",
    chapecoense: "Chapecoense",
    corinthians: "Corinthians",
    coritiba: "Coritiba",
    cruzeiro: "Cruzeiro",
    flamengo: "Flamengo",
    fluminense: "Fluminense",
    gremio: "Gremio",
    internacional: "Internacional",
    mirassol: "Mirassol",
    palmeiras: "Palmeiras",
    remo: "Remo",
    santos: "Santos",
    vasco: "Vasco",
    vitoria: "Vitoria"
  },
  serieb: {
    athleticclub: "Athletic Club",
    atlgoianiense: "Atletico Goianiense",
    avai: "Avai",
    botagofo: "Botafogo",
    ceara: "Ceara",
    crb: "CRB",
    criciuma: "Criciuma",
    cuiaba: "Cuiaba",
    fortaleza: "Fortaleza",
    goias: "Goias",
    juventude: "Juventude",
    londrina: "Londrina",
    nautico: "Nautico",
    novorizontino: "Novorizontino",
    operario: "Operario",
    pontepreta: "Ponte Preta",
    saobernardo: "Sao Bernardo",
    sportrecife: "Sport Recife",
    vilanova: "Vila Nova"
  },
  primeranacional: {
    acassuso: "Acassuso",
    agropecuario: "Agropecuario",
    allboys: "All Boys",
    almagro: "Almagro",
    almirante: "Almirante Brown",
    atlanta: "Atlanta",
    atleticorafaela: "Atletico Rafaela",
    chacarita: "Chacarita Juniors",
    chaco_forever: "Chaco For Ever",
    ciudad_bolivar: "Ciudad Bolivar",
    colegiales: "Colegiales",
    colon: "Colon",
    central_norte: "Central Norte",
    defensores: "Defensores de Belgrano",
    depmaipu: "Deportivo Maipu",
    deportivo_madryn: "Deportivo Madryn",
    ferro: "Ferro",
    gimnasiajujuy: "Gimnasia Jujuy",
    gimnasia_y_tiro: "Gimnasia y Tiro",
    godoycruz: "Godoy Cruz",
    guemes: "Guemes",
    los_andes: "Los Andes",
    midland: "Midland",
    mitre: "Mitre",
    moron: "Moron",
    nueva_chicago: "Nueva Chicago",
    patronato: "Patronato",
    quilmes: "Quilmes",
    racing_cordoba: "Racing Cordoba",
    sanmartinsj: "San Martin SJ",
    sanmartintuc: "San Martin Tuc",
    sanmiguel: "San Miguel",
    santelmo: "San Telmo",
    temperley: "Temperley",
    tristansuarez: "Tristan Suarez"
  },
  primeradivision: {
    aldosivi: "Aldosivi",
    argentinos: "Argentinos Juniors",
    barracas: "Barracas Central",
    banfield: "Banfield",
    belgrano: "Belgrano",
    boca: "Boca Juniors",
    centralcordoba: "Central Cordoba",
    defensa: "Defensa y Justicia",
    estudiantes: "Estudiantes LP",
    estudiantes2: "Estudiantes 2",
    estudiantesrc: "Estudiantes RC",
    gimnasia: "Gimnasia LP",
    gimnasiamendoza: "Gimnasia Mendoza",
    huracan: "Huracan",
    independiente: "Independiente",
    independiente2: "Independiente 2",
    independienteriv: "Independiente Rivadavia",
    instituto: "Instituto",
    lanus: "Lanus",
    newells: "Newells",
    platense: "Platense",
    racing: "Racing Club",
    racing2: "Racing 2",
    riestra: "Deportivo Riestra",
    river: "River Plate",
    rosariocentral: "Rosario Central",
    sarmiento: "Sarmiento",
    sanlorenzo: "San Lorenzo",
    tigre: "Tigre",
    talleres: "Talleres",
    union: "Union",
    velez: "Velez"
  }
};

const prettifyStem = (stem) => {
  const raw = String(stem || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([0-9]+)/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "Club";

  return raw
    .split(" ")
    .map((part) => {
      if (!part) return part;
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
};

const makeAbbrCandidate = (value) => {
  const compactValue = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  if (!compactValue) return null;
  if (compactValue.length === 1) return null;
  return compactValue.slice(0, 3);
};

const deriveAbbr = (name, stem) => {
  const words = String(name || "")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);

  const candidates = [];
  const add = (candidate) => {
    const abbr = makeAbbrCandidate(candidate);
    if (abbr && !candidates.includes(abbr)) candidates.push(abbr);
  };

  add(words.map((word) => word.charAt(0)).join(""));
  if (words.length >= 2) add(words[0].charAt(0) + words[1].slice(0, 2));
  if (words.length >= 2) add(words[0].slice(0, 2) + words[1].charAt(0));
  add(String(stem || name || ""));
  add(words[0] || "");

  const selected = candidates.find((abbr) => abbr.length >= 2 && abbr.length <= 3);
  if (selected) return selected;
  return "CLB";
};

const buildClub = (packKey, fileName) => {
  const stem = path.basename(fileName, path.extname(fileName));
  const normalizedStem = normalize(stem);
  const overrides = NAME_OVERRIDES[packKey] || {};
  const name = overrides[normalizedStem] || prettifyStem(stem);

  return {
    name,
    abbr: deriveAbbr(name, stem),
    shortName: name,
    logoPath: path.join(PACK_ROOT, packKey, fileName),
    emoji: null,
    pack: packKey
  };
};

const readPackClubs = (packKey) => {
  const folder = path.join(PACK_ROOT, packKey);
  if (!fs.existsSync(folder)) return [];

  return fs
    .readdirSync(folder)
    .filter((file) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(file))
    .map((file) => buildClub(packKey, file))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
};

const PACKS = Object.fromEntries(
  Object.keys(PACK_META).map((packKey) => [packKey, readPackClubs(packKey)])
);

const getPackNames = () => Object.keys(PACK_META).map((key) => PACK_META[key].displayName);

const getPackMeta = (packName) => {
  const key = findPackKey(packName);
  if (!key) return null;
  return { key, ...PACK_META[key] };
};

const findPackKey = (value) => {
  const normalized = normalize(value);
  if (!normalized) return null;

  for (const [key, meta] of Object.entries(PACK_META)) {
    if (normalize(key) === normalized) return key;
    if (normalize(meta.displayName) === normalized) return key;
    if (Array.isArray(meta.aliases) && meta.aliases.some((alias) => normalize(alias) === normalized)) {
      return key;
    }
  }

  return null;
};

const getPackClubs = (packName) => {
  const key = findPackKey(packName);
  if (!key) return null;
  return PACKS[key].map((club) => ({ ...club, pack: key }));
};

const findClubInPacks = (clubName) => {
  const normalized = normalize(clubName);
  if (!normalized) return null;

  for (const [packName, clubs] of Object.entries(PACKS)) {
    for (const club of clubs) {
      if (
        normalize(club.name) === normalized ||
        normalize(club.abbr) === normalized ||
        normalize(club.shortName) === normalized
      ) {
        return { ...club, pack: packName };
      }
    }
  }

  return null;
};

module.exports = {
  PACKS,
  getPackNames,
  findPackKey,
  getPackMeta,
  getPackClubs,
  findClubInPacks
};
