const opt=(name,description,type,required=true,extra={})=>({name,description,type,required,...extra});
const commands=[
 {name:'instalaciónkyu',description:'Crea los roles jugador Kyu, Pro y Pro+.'},
 {name:'plan',description:'Asigna un plan con vencimiento.',options:[opt('usuario','Jugador',6),opt('plan','Plan',3,true,{choices:[{name:'Pro',value:'pro'},{name:'Pro+',value:'proplus'}]}),opt('tiempo','Ejemplo: 30d, 12h, 4w',3)]},
 {name:'planremove',description:'Retira el plan y el acceso concedido por el bot.',options:[opt('usuario','Jugador',6)]},
 {name:'jugadores',description:'Vincula un canal o hilo para registrar entradas a KyuApp.',options:[opt('canal','Canal o hilo',7)]},
 {name:'logplanes',description:'Vincula el canal de registros de planes y administradores.',options:[opt('canal','Canal o hilo',7)]},
 {name:'ticket',description:'Publica el panel de atención de KyuApp.'},
 {name:'ticketcerrar',description:'Cierra el ticket actual sin borrar su historial.'},
 {name:'cv',description:'Crea un canal de voz privado para vos y staff.',options:[opt('nombre','Nombre del canal',3)]}
].map(c=>({...c,type:1,default_member_permissions:['cv','ticketcerrar'].includes(c.name)?null:'32',dm_permission:false}));
function ticketPanel(){return {flags:32768,components:[{type:17,accent_color:0xffadd0,components:[{type:10,content:'## 黒龍 · KyuApp\nAtención y soporte\nElegí el motivo de tu consulta. Se abrirá un canal privado.'},{type:14,divider:true},{type:1,components:[{type:3,custom_id:'kyu:ticket',placeholder:'¿En qué te ayudamos?',options:[{label:'Comprar app',value:'comprar'},{label:'Crear tu app',value:'crear'},{label:'Reclamar app',value:'reclamar'},{label:'Consultar',value:'consultar'}]}]},{type:10,content:'marce · m05e · [GitHub](https://github.com/MarceeeJs)'}]}]};}
module.exports={commands,ticketPanel};
