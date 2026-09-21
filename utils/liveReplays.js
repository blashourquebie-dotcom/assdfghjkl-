const api=require('./supabaseClient');
const crypto=require('node:crypto');
async function handle(req,res,guildId,url,writeJson){
 if(req.method!=='POST')return writeJson(res,405,{error:'Usá POST'});
 const token=String(req.headers.authorization||'').replace(/^Bearer /,''),session=url.searchParams.get('session');
 if(!/^[a-f0-9]{64}$/.test(token)||! /^[a-f0-9-]{36}$/.test(session||''))return writeJson(res,403,{error:'Vínculo inválido'});
 try{
  // Reject unknown/revoked/foreign-room credentials before buffering the binary.
  const check=await api.request('rpc/ingest_live_match',{method:'POST',body:{p_token:token,p_guild:guildId,p_session:session,p_seq:0,p_snapshot:null}});
  if(!check.ok)return writeJson(res,403,{error:'Vínculo revocado o sala incorrecta'});
  if(check.data?.snapshot?.status!=='finished')return writeJson(res,409,{error:'El resultado todavía no está finalizado'});
  let length=0,chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>10485760)return writeJson(res,413,{error:'La REC supera 10 MB'});chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  if(length<13||bytes.subarray(0,4).toString('ascii')!=='HBR2')return writeJson(res,400,{error:'Archivo HBR2 inválido'});
  const args={p_token:token,p_guild:guildId,p_session:session,p_size:length,p_sha:crypto.createHash('sha256').update(bytes).digest('hex')};
  const prepared=await api.request('rpc/prepare_live_replay',{method:'POST',body:args});
  if(!prepared.ok)return writeJson(res,409,{error:'No se pudo reservar la REC; revisá la migración y el vínculo'});
  if(!prepared.data.ready){
   await api.uploadOfficialReplay(prepared.data.path,bytes);
   const done=await api.request('rpc/prepare_live_replay',{method:'POST',body:{...args,p_ready:true}});
   if(!done.ok)throw Error('REC cargada; falta confirmar su publicación. Se puede reintentar.');
  }
  return writeJson(res,200,{ok:true,id:prepared.data.id});
 }catch(error){return writeJson(res,503,{error:error.message||'No se pudo subir la REC'});}
}
module.exports={handle};
