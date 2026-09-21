const { randomUUID } = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require("discord.js");
const db = require("./haxoleSupabase");
const { validateConfig, hasGroups } = require("./tournamentFormat");
const drafts = new Map();
const buttons = (id, draft) => ({
  embeds: [new EmbedBuilder().setColor(0x151821).setTitle("Configuración avanzada: " + draft.name).setDescription([
    "Liga: " + draft.tipo.toUpperCase(),
    "Formato: " + draft.formato,
    "Equipos: " + draft.count,
    ...(draft.clubs ? ["Clubes seleccionados: "+draft.clubs.length+" · "+draft.clubs.join(", ").slice(0,1200)] : []),
    ...(hasGroups(draft) ? ["Grupos: " + draft.grupos + " · " + draft.equipos_por_grupo + " equipos por grupo", "Clasifican por grupo: " + draft.clasifican, "Cruces fijos entre grupos A/B, C/D, etc. Por puesto inverso (1º contra último clasificado)."] : []),
    "Ida y vuelta: " + (draft.ida_vuelta ? "Sí" : "No"),
    ...(draft.formato === "copa" ? ["Pases libres: " + (2 ** Math.ceil(Math.log2(draft.count)) - draft.count) + ". Elegí los clubes inscriptos con /torneo antes de /schedule crear."] : []),
    ...(draft.formato === "copa" ? [] : [
      "Etiquetas: " + (draft.etiquetas.map((t) => t.desde + "-" + t.hasta + " " + t.texto).join(", ") || "Sin etiquetas")
    ]),
    "El torneo se guarda al confirmar. Este borrador vence en 20 minutos."
  ].join("\n"))],
  components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("creartorneo:advanced:" + id).setLabel("Editar configuración").setStyle(ButtonStyle.Secondary),
    ...(draft.clubs ? [new ButtonBuilder().setCustomId("creartorneo:clubs:"+id).setLabel("Elegir clubes").setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setCustomId("creartorneo:format:"+id).setLabel("Modo").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("creartorneo:save:" + id).setLabel("Crear torneo").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("creartorneo:cancel:" + id).setLabel("Cancelar").setStyle(ButtonStyle.Danger)
  )]
});
async function begin(interaction, input) {
  for (const [key, value] of drafts) if (value.expires < Date.now()) drafts.delete(key);
  const groups = input.formato === "dos_grupos" ? 2 : input.formato === "libertadores" ? input.count / 4 : null;
  const draft = { ...input, grupos: groups, equipos_por_grupo: groups ? input.count / groups : null, ida_vuelta: false, clasifican: 2, etiquetas: [], owner: interaction.user.id, guild: interaction.guildId || interaction.guild?.id, expires: Date.now() + 20 * 60 * 1000 };
  validateConfig(draft, input.count);
  const id = randomUUID();
  drafts.set(id, draft);
  return interaction.deferred || interaction.replied ? interaction.followUp({ ...buttons(id,draft),flags:64 }) : interaction.reply({ ...buttons(id, draft), flags: 64 });
}
async function handle(interaction, [action, id]) {
  const draft = drafts.get(id);
  if (!draft || draft.expires < Date.now()) return interaction.reply({ content: "Borrador vencido. Volvé a ejecutar /creartorneo.", flags: 64 });
  if (draft.owner !== interaction.user.id || draft.guild !== (interaction.guildId || interaction.guild?.id) || !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Solo el administrador que inició este borrador puede editarlo.", flags: 64 });
  if (draft.busy) return interaction.reply({ content: "Esta configuración se está procesando.", flags: 64 });
  if (action === "cancel") { drafts.delete(id); return interaction.update({ content: "Creación cancelada.", embeds: [], components: [] }); }
  if(draft.createdId && action!=="save")return interaction.reply({content:"El torneo ya fue creado; reintentá guardar las inscripciones pendientes.",flags:64});
  if(action==="clubs"||action==="format"){
    const isClubs=action==="clubs";
    const modalId="tournament-selection-"+id;
    await interaction.showModal(new ModalBuilder().setCustomId(modalId).setTitle(isClubs?"Clubes del torneo":"Modo del torneo").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("value").setLabel(isClubs?"Clubes habilitados (uno por línea)":"liga / copa / dos_grupos / libertadores").setStyle(isClubs?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(true).setMaxLength(4000).setValue(isClubs?(draft.clubs||[]).join("\n").slice(0,4000):draft.formato))));
    const submit=await interaction.awaitModalSubmit({time:300000,filter:i=>i.customId===modalId&&i.user.id===draft.owner}).catch(()=>null);
    if(!submit)return;
    if(!drafts.has(id)||draft.expires<Date.now()||draft.busy||draft.createdId)return submit.reply({content:"Borrador no disponible.",flags:64});
    try{
      if(isClubs){draft.clubs=require("./packTournamentSelection").selectClubs(submit.fields.getTextInputValue("value"),draft.modality);}
      else{
        const formato=submit.fields.getTextInputValue("value").trim().toLowerCase();if(!["liga","copa","dos_grupos","libertadores"].includes(formato))throw Error("Modo inválido");
        const candidate={...draft,formato,etiquetas:[],clasifican:2};
        if(formato==="libertadores"){candidate.count=32;candidate.grupos=8;candidate.equipos_por_grupo=4;}
        else if(formato==="dos_grupos"){candidate.count=Math.max(4,Math.ceil(draft.count/2)*2);candidate.grupos=2;candidate.equipos_por_grupo=candidate.count/2;}
        validateConfig(candidate,candidate.count);Object.assign(draft,candidate);
      }
      return submit.update(buttons(id,draft));
    }catch(error){return submit.reply({content:error.message,flags:64});}
  }
  if (action === "advanced") {
    const field = (name, label, value, paragraph = false) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(name).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(name !== "tags").setValue(value));
    const modalId = "tournament-config-" + id;
    await interaction.showModal(new ModalBuilder().setCustomId(modalId).setTitle("Configuración del torneo").addComponents(
      field("legs", "Ida y vuelta: si / no", draft.ida_vuelta ? "si" : "no"),
      ...(hasGroups(draft) ? [
        field("groups", draft.formato === "dos_grupos" ? "Equipos por grupo (siempre son 2 grupos)" : "Grupos x equipos: ej. 8 x 4 (solo 8 = 8 x 4)", draft.formato === "dos_grupos" ? String(draft.equipos_por_grupo) : draft.grupos + " x " + draft.equipos_por_grupo),
        field("qualifiers", "Clasificados por grupo", String(draft.clasifican))
      ] : [field("count", "Cantidad de equipos", String(draft.count))]),
      ...(draft.formato === "copa" ? [] : [
        field("tags", "Una por línea: 1-1 | #116633 | CAMPEON", draft.etiquetas.map((t) => t.desde + "-" + t.hasta + " | " + t.color + " | " + t.texto).join("\n"), true)
      ])
    ));
    const submit = await interaction.awaitModalSubmit({ time: 300000, filter: (i) => i.customId === modalId && i.user.id === draft.owner }).catch(() => null);
    if (!submit) return;
    if (!drafts.has(id) || draft.expires < Date.now() || draft.busy) return submit.reply({ content: "El borrador ya no está disponible.", flags: 64 });
    try {
      const legs = submit.fields.getTextInputValue("legs").trim().toLowerCase();
      if (!["si", "sí", "no"].includes(legs)) throw new Error("Ida y vuelta debe ser si o no.");
      const candidate = { ...draft, ida_vuelta: legs !== "no", clasifican: hasGroups(draft) ? Number(submit.fields.getTextInputValue("qualifiers")) : 0, etiquetas: draft.formato === "copa" ? [] : submit.fields.getTextInputValue("tags").split("\n").filter((line) => line.trim()).map((line) => {
        const [range, color, texto] = line.split("|").map((s) => s.trim());
        const [desde, hasta] = range.split("-").map(Number);
        return { desde, hasta, color, texto };
      }) };
      if (hasGroups(draft)) {
        const layout = submit.fields.getTextInputValue("groups").trim();
        if (draft.formato === "dos_grupos") {
          if (!/^\d+$/.test(layout)) throw new Error("Indicá la cantidad de equipos por grupo.");
          candidate.grupos = 2; candidate.equipos_por_grupo = Number(layout);
        } else {
          const parts = layout.match(/^(\d+)(?:\s*[xX×]\s*(\d+))?$/);
          if (!parts) throw new Error("Usá grupos x equipos, por ejemplo 8 x 4.");
          candidate.grupos = Number(parts[1]); candidate.equipos_por_grupo = Number(parts[2] || 4);
        }
        candidate.count = candidate.grupos * candidate.equipos_por_grupo;
      } else candidate.count = Number(submit.fields.getTextInputValue("count"));
      validateConfig(candidate, candidate.count);
      Object.assign(draft, candidate);
      return submit.update(buttons(id, draft));
    } catch (error) { return submit.reply({ content: error.message, flags: 64 }); }
  }
  if (action !== "save") return;
  draft.busy = true;
  await interaction.deferUpdate();
  try {
    validateConfig(draft, draft.count);
    const modality = await db.ensureModalidad(draft.modality);
    if (!modality) throw new Error("No se pudo obtener la modalidad.");
    const configuracion = { ida_vuelta: draft.ida_vuelta, ...(draft.formato !== "copa" ? { etiquetas: draft.etiquetas } : {}), ...(hasGroups(draft) ? { clasifican: draft.clasifican, grupos: draft.grupos, equipos_por_grupo: draft.equipos_por_grupo } : {}) };
    const enrollment = draft.clubs ? await require("./packTournamentSelection").resolveClubs(draft.clubs,draft.modality,draft.count,db) : [];
    const result = draft.createdId ? {ok:true,data:[{id:draft.createdId}]} : await db.request("torneos", { method: "POST", prefer: "return=representation", body: { modalidad_id: modality.id, nombre: draft.name, cantidad_equipos: draft.count, tipo: draft.tipo, estado: "activo", modo_copa: draft.formato === "copa", formato: draft.formato, configuracion } });
    if (!result.ok) {
      if (/23505|duplicate key/i.test(String(result.error))) throw new Error('Ya existe ese nombre en esta modalidad y liga. Si pertenece a otra liga, falta aplicar la migración 202609120002_tournament_league_names. No se modificó el torneo existente.');
      throw new Error('No se guardó el torneo. Verificá las migraciones 202609100001 y 202609120002 y la conexión a Supabase.');
    }
    if(draft.clubs){
      draft.createdId=result.data?.[0]?.id;
      if(!draft.createdId)throw Error("No se recibió el ID del torneo; revisá Supabase antes de reintentar.");
      const enrolled=await db.request("torneo_clubes",{method:"POST",params:{on_conflict:"torneo_id,club_id"},prefer:"resolution=merge-duplicates,return=representation",body:enrollment.map((c,i)=>({torneo_id:draft.createdId,club_id:c.id,posicion:i+1}))});
      if(!enrolled.ok)throw Error("Torneo creado, pero faltó inscribir clubes. Reintentá Crear torneo en este panel: no se duplicará.");
    }
    drafts.delete(id);
    return interaction.editReply({ content: "Torneo creado: " + draft.name + (draft.clubs ? ". Clubes inscriptos: "+draft.clubs.length+". Ejecutá /schedule crear." : ". Inscribí los clubes y ejecutá /schedule crear."), embeds: [], components: [] });
  } catch (error) { return interaction.followUp({ content: error.message, flags: 64 }); }
  finally { draft.busy = false; }
}
module.exports = { begin, handle };
