const opt=(name,description,type,required=true,extra={})=>({name,description,type,required,...extra});
const commands=[
 {name:'instalaciónkyu',description:'Crea los roles jugador Kyu, Pro y Pro+.'},
 {name:'plan',description:'Asigna un plan con vencimiento.',options:[opt('usuario','Jugador',6),opt('plan','Plan',3,true,{choices:[{name:'Pro',value:'pro'},{name:'Pro+',value:'proplus'},{name:'Kyu',value:'playerRole'},{name:'Beta',value:'beta'},{name:'Ver',value:'ver'}]}),opt('tiempo','Ejemplo: 30d, 12h, 4w',3)]},
 {name:'planremove',description:'Retira el plan Pro/Pro+ sin modificar el rol jugador.',options:[opt('usuario','Jugador',6)]},
 {name:'introduccion',description:'Publica la introducción de KyuApp y 2J App Lite.'},
 {name:'planes',description:'Publica los planes y guarda los precios indicados.',options:['pro_ars','pro_uyu','pro_boosts','proplus_ars','proplus_uyu','proplus_boosts'].map(k=>opt(k,k.replaceAll('_',' '),4,false,{min_value:1,max_value:10000000}))},
 {name:'prolist',description:'Lista los planes vigentes registrados por el bot.',options:[opt('plan','Filtrar por plan',3,false,{choices:[{name:'Pro',value:'pro'},{name:'Pro+',value:'proplus'},{name:'Kyu',value:'playerRole'},{name:'Beta',value:'beta'},{name:'Ver',value:'ver'}]}),opt('pagina','Página de resultados',4,false,{min_value:1})]},
 {name:'betatester',description:'Abre las inscripciones para el programa Beta Tester.',options:[opt('cantidad','Cupo de betatesters',4,true,{min_value:1,max_value:10000}),opt('rol','Rol beta (por defecto busca el nombre beta)',8,false)]},
 {name:'betaestado',description:'Muestra el cupo y las inscripciones pendientes.'},
 {name:'betacerrar',description:'Cierra la inscripción beta sin retirar los roles.'},
 {name:'jugadores',description:'Vincula un canal o hilo para registrar entradas a KyuApp.',options:[opt('canal','Canal o hilo',7)]},
 {name:'logplanes',description:'Vincula el canal de registros de planes y administradores.',options:[opt('canal','Canal o hilo',7)]},
 {name:'ticket',description:'Publica el panel de atención de KyuApp.'},
 {name:'ticketcerrar',description:'Cierra el ticket actual sin borrar su historial.'},
 {name:'cv',description:'Crea un canal de voz privado para vos y staff.',options:[opt('nombre','Nombre del canal',3)]}
].map(c=>({...c,type:1,default_member_permissions:['cv','ticketcerrar'].includes(c.name)?null:'32',dm_permission:false}));

function ticketPanel(){return {flags:32768,components:[{type:17,accent_color:0x6f8cff,components:[
 {type:10,content:'# 🎟️ TICKETS · KYUAPP\n\nCreá un ticket para **soporte**, reportar un **bug** o consultar por un **plan**. El canal será privado y el equipo te responderá apenas pueda.'},
 {type:14,divider:true},
 {type:10,content:'### 🛰️ Soporte Kyu\n- \`💬\` Dudas sobre KyuApp o 2J App Lite\n- \`🐛\` Bugs, errores o problemas de instalación\n- \`💎\` Plan Pro / Pro+ y compras\n\nIndicá tu idioma y explicá el caso con claridad: **Español · English · Português**.'},
 {type:1,components:[{type:3,custom_id:'kyu:ticket',placeholder:'Elegí una categoría',options:[
  {label:'Soporte y consultas',description:'Ayuda con KyuApp o 2J App Lite',value:'consultar',emoji:{name:'💬'}},
  {label:'Reportar un bug',description:'Explicá qué pasó y cómo repetirlo',value:'reclamar',emoji:{name:'🐛'}},
  {label:'Plan o compra',description:'Consultá Pro, Pro+ y formas de pago',value:'comprar',emoji:{name:'💎'}},
  {label:'Instalación / creación',description:'Ayuda para instalar o crear tu app',value:'crear',emoji:{name:'⚙️'}}
 ]}]},
 {type:10,content:'> Elegí una categoría para abrir tu ticket.'},
 {type:14,divider:true},
 {type:10,content:'Developed by **\`@m05e.\`**'}
]}]};}
module.exports={commands,ticketPanel};
