'use strict';
exports.createStorage=function(env,transport=fetch){
 const origin=env.KYU_SUPABASE_URL||'https://oqvzemxyfdszzvfeovbd.supabase.co',bucket=env.KYU_SUPABASE_BUCKET||'kyu-originals';
 if(new URL(origin).origin!==origin||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin))throw Error('Origen Supabase inválido.');
 if(!/^[a-z0-9-]+$/.test(bucket))throw Error('Bucket inválido.');
 return {async sign(object){
  const key=env.KYU_SUPABASE_SECRET_KEY;if(!key)throw Object.assign(Error('Falta configurar Supabase en el servidor.'),{status:503});
  if(typeof object!=='string'||!object||object.split('/').some(p=>!p||p==='.'||p==='..')||!/^[a-zA-Z0-9_./-]+$/.test(object))throw Error('Ruta de asset inválida.');
  const r=await transport(origin+'/storage/v1/object/sign/'+bucket+'/'+object.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120}),redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Object.assign(Error('No se pudo autorizar la descarga privada.'),{status:503});
  const data=await r.json();if(typeof data.signedURL!=='string')throw Error('Respuesta de Storage inválida.');const value=data.signedURL.startsWith('/object/')?'/storage/v1'+data.signedURL:data.signedURL,url=new URL(value,origin+'/storage/v1/');if(url.origin!==origin||!url.pathname.startsWith('/storage/v1/object/sign/'+bucket+'/'))throw Error('Respuesta de Storage inválida.');return url.href;
 }};
};
