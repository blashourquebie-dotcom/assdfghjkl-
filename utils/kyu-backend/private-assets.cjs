'use strict';
const fs=require('node:fs');
exports.create=function({manifest,owned,transport=fetch,storage}){
 let catalog;
 function read(){if(!manifest)throw Object.assign(Error('El servidor de originales todavía no está configurado.'),{status:503});if(!catalog){catalog=JSON.parse(fs.readFileSync(manifest,'utf8'));if(!Array.isArray(catalog))throw Error('Catálogo privado inválido.');}return catalog;}
 return {async item(user,id){
  // Check on every request, before reading the private manifest or fetching bytes.
  if(!owned(user).includes(id))throw Object.assign(Error('No adquiriste este cosmético.'),{status:403});
  const item=read().find(i=>i.id===id);if(!item)throw Object.assign(Error('Original no disponible.'),{status:404});
  const layers=await Promise.all((item.layers||[]).map(async layer=>{
   if(layer.object){if(!storage)throw Object.assign(Error('Storage no configurado.'),{status:503});const {object,...rest}=layer;return {...rest,src:await storage.sign(object)};}
   if(/^data:(image\/(png|gif|webp|jpeg)|video\/webm);base64,/.test(layer.src))return layer;
   const url=new URL(layer.src);if(url.protocol!=='https:'||url.hostname!=='cdn.discordapp.com')throw Error('Origen de asset no autorizado.');
   const r=await transport(url.href,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Original temporalmente no disponible.');
   const type=(r.headers.get('content-type')||'').split(';')[0];if(!['image/png','image/gif','image/webp','image/jpeg','video/webm'].includes(type))throw Error('Formato no autorizado.');
   const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>20*1024*1024)throw Error('Asset demasiado grande.');chunks.push(Buffer.from(chunk));}
   return {...layer,src:'data:'+type+';base64,'+Buffer.concat(chunks).toString('base64')};
  }));return {...item,layers,thumbnail:undefined,reducedMotion:undefined};
 }};
};
