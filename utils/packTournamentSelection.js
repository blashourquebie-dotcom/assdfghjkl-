const {readConfig}=require('./database');
function selectClubs(raw,modality,cfg=readConfig()){
 const names=[...new Set(String(raw).split(/\r?\n/).map(n=>n.trim()).filter(Boolean))];
 if(!names.length||names.length>128)throw Error('Elegí entre 1 y 128 clubes.');
 const available=Object.entries(cfg.clubs||{}).filter(([,c])=>c.roles?.[modality]).map(([key,c])=>({name:c.name||key,abbr:c.abbr}));
 const resolved=names.map(name=>{const matches=available.filter(c=>c.name.toLowerCase()===name.toLowerCase()||String(c.abbr||'').toLowerCase()===name.toLowerCase());if(matches.length!==1)throw Error('Club no habilitado o ambiguo: '+name);return matches[0].name;});
 return [...new Set(resolved)];
}
async function resolveClubs(names,modality,count,db){
 const selected=selectClubs(names.join('\n'),modality);
 if(selected.length>count)throw Error('Hay más clubes seleccionados que cupos. Editá la configuración o la selección.');
 const rows=[];for(const name of selected){const row=await db.ensureClubRow(name);if(!row?.id)throw Error('No se pudo obtener el club: '+name);rows.push(row);}return rows;
}
module.exports={selectClubs,resolveClubs};
