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
const { getBanner, footerTextFor } = require("../utils/banners");

const textBlock = (content) => new TextDisplayBuilder().setContent(content);
const separator = () => new SeparatorBuilder().setDivider(true);

const buildScriptContainer = ({ banner, footer }) => {
  const container = new ContainerBuilder()
    .setAccentColor(0xb0091c)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(banner.url)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      textBlock([
        "# ðŸ“¦ HaxOle Script - Oficiales",
        "Herramienta para hostear oficiales con validaciÃ³n automÃ¡tica de identidad.",
        "Uso **NO** obligatorio, pero recomendado para oficiales.",
        "",
        "Version **`v1.0.2`**",
        "",
        "El script manda ENTRYs al bot, valida auths y bloquea al jugador hasta que confirme por DM."
      ].join("\n"))
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      textBlock([
        "## Comandos",
        [
          "â€¢ `!auth` muestra tu auth actual",
          "â€¢ `!firmo @TuUserDeDiscord` para firmar en oficiales",
          "â€¢ `!firmas` visualiza firmas",
          "â€¢ `!x3`, `!x4`, `!x5`, `!x7` seleccionan modalidad",
          "â€¢ `!oficial` activa el modo oficial",
          "â€¢ `!liga`",
          "â€¢ `!swap`",
          "â€¢ `!resetear`",
          "â€¢ `!red` / `!blue` para camisetas del club"
        ].join("\n")
      ].join("\n"))
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      textBlock([
        "## Validacion de identidad",
        [
          "â€¢ Cada jugador que entra genera un ENTRY con AUTH / CONN / IP",
          "â€¢ El bot de Discord busca la auth registrada con `/validarauth`",
          "â€¢ Si la auth existe, manda un DM con botones para confirmar",
          "â€¢ Si no existe, el script avisa que registre la auth y relogee",
          "â€¢ El jugador no puede hablar ni entrar a equipos hasta validar"
        ].join("\n")
      ].join("\n"))
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      textBlock([
        "## Notas",
        [
          "â€¢ ENTRY y firmas van separados",
          "â€¢ Solo admins pueden pedir esta plantilla",
          "â€¢ Pensado para oficiales con control de identidad real"
        ].join("\n")
      ].join("\n"))
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(textBlock(`**${footer}**`));

  return container;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("script")
    .setDescription("Muestra la plantilla del script oficial de HaxOle")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const isAdmin = interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      return interaction.reply({ content: "Solo administradores pueden usar este comando.", flags: 64 });
    }

    const banner = getBanner("help");
    const footer = await footerTextFor(interaction);

    return interaction.reply({
      components: [buildScriptContainer({ banner, footer })],
      files: [banner.attachment],
      flags: MessageFlags.IsComponentsV2
    });
  }
};

