'use strict';
const shop=require('./shop-catalog.cjs'),ids=shop.items.map(i=>i.id);
exports.createEconomy=function(db,save,now=Date.now){
 db.suprs=db.suprs||{accounts:{},credits:{}};
 function account(id){if(!/^\d{17,20}$/.test(id))throw Error('Usuario inválido.');return db.suprs.accounts[id]||{balance:0,received:0,spent:0,owned:[],history:[]};}
 function commit(run){const old=db.suprs;db.suprs=JSON.parse(JSON.stringify(old));try{const result=run();save();return result;}catch(e){db.suprs=old;throw e;}}
 function wallet(id,page=1){const a=account(id),p=Math.max(1,Math.floor(Number(page)||1));return {...a,history:a.history.slice().reverse().slice((p-1)*10,p*10),page:p,pages:Math.max(1,Math.ceil(a.history.length/10))};}
 function prices(){return Object.fromEntries(shop.items.map(i=>[i.id,Object.hasOwn(db.suprPrices||{},i.id)?(Number.isSafeInteger(db.suprPrices[i.id])&&db.suprPrices[i.id]>0?db.suprPrices[i.id]:null):i.price]));}
 function bundle(id){const rotation=shop.rotation(now()),hash=require('crypto').createHash('sha256').update('kyu-suprs:'+rotation.key).digest(),items=['frame','avatar','effect'].map((category,index)=>{const pool=shop.items.filter(i=>i.category===category);return pool[hash.readUInt16BE(index*2)%pool.length].id;}),owned=account(id).owned,missing=items.filter(i=>!owned.includes(i)),p=prices(),discount=15,normal=missing.every(i=>p[i]!=null)?missing.reduce((sum,i)=>sum+p[i],0):null;return {id:'bundle:'+rotation.key,items,missing,discount,normal,price:normal!==null&&discount!==null?Math.ceil(normal*(100-discount)/100):null,expires:rotation.expires};}
 function redeemBundle(id,item,expected){const offer=bundle(id);if(item!==offer.id)throw Error('El pack cambió. Revisá la oferta actual.');if(!offer.missing.length)return wallet(id);if(offer.price===null||offer.price!==expected)throw Error('Pack sin precio o precio modificado.');if(account(id).balance<offer.price)throw Error('No tenés suficientes SUPRs.');return commit(()=>{const a=account(id);a.balance-=offer.price;a.spent+=offer.price;a.owned.push(...offer.missing);a.history.push({type:'redeem',item,items:offer.missing,amount:offer.price,at:now()});db.suprs.accounts[id]=a;return wallet(id);});}
 return {wallet,prices,bundle,credit(id,amount,actor,receipt){
  if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)throw Error('Cantidad: entero entre 1 y 1.000.000.');
  if(!/^\d{17,20}$/.test(String(receipt)))throw Error('Falta el identificador de la interacción.');
  const duplicate=db.suprs.credits[receipt];if(duplicate){if(duplicate.id!==id||duplicate.amount!==amount)throw Error('Movimiento incompatible.');return wallet(id);}
  return commit(()=>{const a=account(id);if(!Number.isSafeInteger(a.balance+amount)||!Number.isSafeInteger(a.received+amount))throw Error('Saldo fuera de rango.');a.balance+=amount;a.received+=amount;a.history.push({type:'credit',amount,at:Date.now(),actor,receipt});db.suprs.accounts[id]=a;db.suprs.credits[receipt]={id,amount};return wallet(id);});
 },redeem(id,item,expectedPrice){
  if(typeof item==='string'&&item.startsWith('bundle:'))return redeemBundle(id,item,expectedPrice);
  const price=prices()[item];if(!ids.includes(item)||price==null)throw Error('Artículo sin precio: canje no habilitado.');
  const a=account(id);if(a.owned.includes(item))return wallet(id);
  if(expectedPrice!==price)throw Error('El precio cambió. Volvé a revisar el artículo.');
  if(a.balance<price)throw Error('No tenés suficientes SUPRs.');
  return commit(()=>{const target=account(id);target.balance-=price;target.spent+=price;target.owned.push(item);target.history.push({type:'redeem',item,amount:price,at:Date.now()});db.suprs.accounts[id]=target;return wallet(id);});
 }};
};
