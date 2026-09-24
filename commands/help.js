const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} = require("discord.js");
const { readConfig } = require("../utils/database");
const { getBanner, footerTextFor } = require("../utils/banners");

const hasAdmin = (interaction) =>
  Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator));

const getCaptainLinks = (userId) => {
  const cfg = readConfig();
  const links = [];

  for (const [clubName, club] of Object.entries(cfg.clubs || {})) {
    for (const [modality, captainId] of Object.entries(club?.captains || {})) {
      if (String(captainId) === String(userId)) {
        links.push(`${clubName} ${modality}`);
      }
    }
  }

  return links;
};

const COMMANDS = {
  help: {
    usage: "!help [comando]",
    short: "Muestra la ayuda general o explica un comando puntual.",
    detail: "Usalo como `!help ficho`, `!help sancionar` o `/help comando:ficho`."
  },
  cs: {
    aliases: ["chargestat"],
    usage: "!cs x3 5 goles @user 2, @user2 3",
    short: "Carga stats de una fecha para varios jugadores.",
    detail: "Solo admins. Guarda goles, asistencias, valla invicta o goles en contra para rankings y tiers."
  },
  tiers: {
    aliases: ["tier"],
    usage: "!tiers general",
    short: "Muestra el ranking de puntos de tiers.",
    detail: "Calcula puntos con 1 gol = 1, 1 asistencia = 0,5 y 1 minuto de valla invicta = 0,2."
  },
  script: {
    usage: "!script",
    short: "Muestra el script oficial para descargar.",
    detail: "Elegí Futsal o Real Soccer y descargá la versión ofuscada de tu liga. Solo admins."
  },
  validarauth: {
    usage: "/validarauth auth:xxxx razon:xxxx",
    short: "Vincula una auth de HaxBall a tu Discord.",
    detail: "Registra tu identidad para la validacion automatica del host."
  },
  auths: {
    aliases: ["!auths"],
    usage: "/auths o !auths",
    short: "Muestra tus auths vinculadas.",
    detail: "Lista todas las auths registradas para tu Discord en este servidor."
  },
  eliminarauth: {
    usage: "/eliminarauth auths:xxxx, yyyy",
    short: "Elimina auths vinculadas.",
    detail: "Quita una o varias auths del registro de identidad."
  },
  ficho: {
    aliases: ["f"],
    usage: "!f @usuario, @usuario",
    short: "Ficha jugadores desde el foro/canal del club vinculado.",
    detail: "Solo CAP/SC del club/modalidad o admins."
  },
  cancelo: {
    aliases: ["c", "canc", "cancel", "cancell"],
    usage: "!c @usuario, @usuario",
    short: "Cancela jugadores desde el foro/canal vinculado.",
    detail: "Quita el rol del club de esa modalidad y actualiza plantilla, historial y nick."
  },
  cedercap: {
    aliases: ["cc", "ce"],
    usage: "!cc @usuario [cancelar]",
    short: "Cede la capitania del club/modalidad del foro.",
    detail: "Debe usarse dentro del foro vinculado o con parametros slash completos."
  },
  cap: {
    usage: "!cap @usuario",
    short: "Marca CAP en el club/modalidad del foro vinculado.",
    detail: "Solo admins."
  },
  sc: {
    aliases: ["subcap", "subcapitan"],
    usage: "!sc @usuario",
    short: "Asigna subcapitan.",
    detail: "Permite marcar un segundo responsable del club."
  },
  habilitarclub: {
    aliases: ["h", "hc", "habilitarc", "habilitar"],
    usage: "!hc Club, ABC, x3,x4 @capitan",
    short: "Crea roles de club y lo habilita en modalidades.",
    detail: "Requiere admin. Si pasas un torneo, solo te deja ver torneos de la modalidad elegida."
  },
  entry: {
    aliases: ["e"],
    usage: "!e modalidad:x3 club:Club torneo:T1 [club_a_reemplazar:OldClub]",
    short: "Inscribe el club del foro en un torneo.",
    detail: "Requiere admin. En un foro vinculado, toma el club y la modalidad automaticamente. Si indicas `club_a_reemplazar`, ocupa exactamente ese lugar."
  },
  left: {
    usage: "!left Liga T1",
    short: "Saca el club del foro de un torneo.",
    detail: "Requiere admin. En un foro vinculado, toma el club y la modalidad automaticamente."
  },
  creartorneo: {
    usage: "/creartorneo modalidad:x3 torneo:Liga T3 cantidad_equipos:12 modo:copa",
    short: "Crea un torneo para una modalidad.",
    detail: "Requiere admin. Usa modo `liga` o `copa`. En copa se interpreta como mata-mata."
  },
  server: {
    usage: "/server nombre:HAXOLE #TEMATICO",
    short: "Etiqueta este servidor para separar su configuracion.",
    detail: "Requiere admin. Si no pones nombre, queda como `general`."
  },
  refresh: {
    aliases: ["sincronizarroles", "rr"],
    usage: "!refresh [modalidades:x3,x4]",
    short: "Sincroniza plantillas, roles y Supabase.",
    detail: "Requiere admin. Recorre los clubes habilitados, corrige plantillas y vuelve a guardar la relacion con Supabase."
  },
  eliminartorneo: {
    usage: "/borrartorneo",
    short: "Abre la lista de torneos para borrar uno vacío.",
    detail: "Requiere admin. No borra partidos ni historial. /eliminartorneo funciona igual."
  },
  borrarclub: {
    usage: "/borrarclub",
    short: "Abre la lista de clubes para dar uno de baja.",
    detail: "Requiere admin. Conserva resultados en torneos finalizados y no borra clubes con partidos activos."
  },
  vincularinformes: {
    aliases: ["vininformes"],
    usage: "/vincularinformes modalidad:x3 torneo:Liga T3",
    short: "Vincula el hilo actual a un torneo.",
    detail: "Requiere admin. El hilo queda atado al torneo de la web para cargar informes y actualizar el fixture."
  },
  cargarstat: {
    aliases: ["chargestat"],
    usage: "!cargarstat x3 Liga T3 2",
    short: "Carga un informe oficial y actualiza el partido.",
    detail: "Requiere admin. Lee la plantilla del informe, guarda o actualiza el partido del fixture, registra los stats y sincroniza tiers."
  },
  deshabilitarclub: {
    aliases: ["d", "deshabilitar"],
    usage: "!d Club x3,x4 sancionar:si",
    short: "Deshabilita un club o algunas modalidades.",
    detail: "Borra roles y desvincula foros. Marcar como sanción es opcional; por defecto, no."
  },
  foroclub: {
    aliases: ["fc"],
    usage: "!fc Club, x3",
    short: "Vincula el foro actual a un club.",
    detail: "El bot publica y mantiene actualizada la plantilla del club."
  },
  clear: {
    usage: "!clear o !clear all",
    short: "Limpia el foro vinculado sin tocar portada ni plantilla.",
    detail: "`!clear` preserva imagenes, plantilla y mensajes que empiezan con c/f."
  },
  limit: {
    aliases: ["lpjs"],
    usage: "!limit x3 12",
    short: "Configura limite de jugadores por modalidad o rol.",
    detail: "Requiere admin."
  },
  mercado: {
    usage: "!mercado x3 ...",
    short: "Configura el mercado de fichajes por modalidad.",
    detail: "Requiere admin."
  },
  sancionar: {
    usage: "!sancionar @user, @user 1s razon",
    short: "Aplica sancion temporal.",
    detail: "Requiere admin. Tiempo: `s` semanas, `m` meses, `a` anios."
  },
  clearsancion: {
    usage: "!clearsancion @user 1s",
    short: "Limpia o reduce sanciones.",
    detail: "Sin tiempo elimina la sancion completa."
  },
  info: {
    usage: "!info",
    short: "Muestra estado general del bot y servidor.",
    detail: "Resume clubes, modalidades, foros vinculados y prefijos activos."
  },
  configuracion: {
    usage: "/configuracion ver | activar | desactivar",
    short: "Muestra o cambia configuraciones del bot.",
    detail: "Sirve para ver apodos automaticos, orden de roles y anti spam, o activar/desactivar esas opciones."
  },
  agregarmodalidad: {
    usage: "/agregarmodalidad modalidad:x8 limite_jugadores:12 limite_sc:2",
    short: "Agrega una modalidad con roles y limites.",
    detail: "Crea los roles base de esa modalidad, habilita la modalidad y guarda limites opcionales."
  },
  instalacion: {
    usage: "/instalacion liga configurar [modalidades:x3,x4] [plantilla_canales:true] [sobreescribir_canales:true] / instalacion club configurar [...]",
    short: "Prepara el servidor con roles base y configuracion inicial.",
    detail: "Crea o reutiliza los roles de jugador, capitan, subcapitan y segunda division. Tambien puede generar la plantilla de canales del bot."
  }
};

const normalizeName = (raw) =>
  String(raw || "").toLowerCase().replace(/^!|\//g, "");

const findCommand = (raw) => {
  const key = normalizeName(raw);
  if (COMMANDS[key]) return [key, COMMANDS[key]];
  return Object.entries(COMMANDS).find(([, meta]) => (meta.aliases || []).includes(key)) || null;
};

const asCommandList = (items) => items.map((item) => `\`${item}\``).join(", ");

const textBlock = (content) => new TextDisplayBuilder().setContent(content);
const separator = () => new SeparatorBuilder().setDivider(true);

const buildHelpContainer = ({ banner, footer, title, intro, sections }) => {
  const container = new ContainerBuilder()
    .setAccentColor(0xb0091c)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(banner.url)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(textBlock([`# ${title}`, intro].filter(Boolean).join("\n")));

  for (const section of sections) {
    container
      .addSeparatorComponents(separator())
      .addTextDisplayComponents(textBlock([`## ${section.title}`, section.body].filter(Boolean).join("\n")));
  }

  container
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(textBlock(`**${footer}**`));

  return container;
};

const replyWithHelp = (interaction, banner, container) =>
  interaction.reply({
    components: [container],
    files: [banner.attachment],
    flags: MessageFlags.IsComponentsV2
  });

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Muestra ayuda general o de un comando")
    .addStringOption((o) =>
      o
        .setName("comando")
        .setDescription("Comando a explicar, ej: ficho")
        .setRequired(false)
    ),

  async execute(interaction) {
    const banner = getBanner("help");
    const footer = await footerTextFor(interaction);
    const requested = interaction.options.getString("comando");

    if (requested) {
      const found = findCommand(requested);
      if (!found) {
        return interaction.reply({
          content: `No encontre ayuda para **${requested}**. Usa \`!help\` para ver la lista.`
        });
      }

      const [name, meta] = found;
      const sections = [
        { title: "Uso", body: `\`${meta.usage}\`` },
        ...(meta.aliases?.length
          ? [{ title: "Aliases", body: meta.aliases.map((a) => `\`!${a}\``).join(", ") }]
          : []),
        { title: "Descripcion", body: meta.short },
        { title: "Detalles", body: meta.detail }
      ];

      return replyWithHelp(interaction, banner, buildHelpContainer({
        banner,
        footer,
        title: name,
        intro: "Ficha rapida del comando.",
        sections
      }));
    }

    const admin = hasAdmin(interaction);
    const captainLinks = getCaptainLinks(interaction.user.id);
    const prefix = (readConfig().meta?.prefix || ["!"])[0] || "!";

    const sections = [
      {
        title: "Usuario",
        body: asCommandList(["help", "plantilla", "club", "clubs", "info", "argentina", "brasil", "paraguay", "uruguay", "chile", "bolivia", "peru", "otro"])
      }
    ];

    if (captainLinks.length) {
      sections.push({
        title: "Capitanes",
        body: [
          asCommandList(["ficho/!f", "cancelo/!c", "cedercap/!cc", "sc", "vinclub/!vc", "clear"]),
          "",
          `CAP en: ${captainLinks.slice(0, 5).join(", ")}${captainLinks.length > 5 ? "..." : ""}`
        ].join("\n")
      });
    }

    if (admin) {
      sections.push({
        title: "Admin",
        body: asCommandList(["instalacion", "server", "agregarmodalidad", "configuracion", "habilitarclub/!h", "habilitarclub/!hc", "entry/!e", "left/!left", "creartorneo", "refresh/!refresh", "eliminartorneo", "borrarclub", "vincularinformes", "cargarstat/!cargarstat", "deshabilitarclub/!d", "foroclub/!fc", "clear", "limit", "mercado", "sancionar", "clearsancion", "script/!script", "validarauth", "auths/!auths", "eliminarauth", "purge", "lock", "unlock", "prefixchange", "tiers/!tier"])
      });
    }

    return replyWithHelp(interaction, banner, buildHelpContainer({
      banner,
      footer,
      title: "Centro de ayuda",
      intro: `Usa \`${prefix}help comando\` para ver una ficha completa.\nEj: \`${prefix}help ficho\``,
      sections
    }));
  }
};
