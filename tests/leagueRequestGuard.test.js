const { test } = require('node:test');
const assert = require('node:assert/strict');
const scope = require('../utils/tournamentScope');
const { withGuild } = require('../utils/database');
const { guard } = require('../utils/leagueRequestGuard');
const ash = '1293616776747286631', tem = '1513342723594129458';
const records = {
 torneos: [{id:'a',tipo:'ash'}, {id:'t',tipo:'tematico'}],
 partidos: [{id:'ma',torneo_id:'a'}, {id:'mt',torneo_id:'t'}],
 jugadores: [{id:'pa',discord_guild_id:ash}, {id:'pt',discord_guild_id:tem}],
 torneo_clubes: [{id:'tc-a',torneo_id:'a'}, {id:'tc-t',torneo_id:'t'}]
};
const read = async (table, {params}) => ({ok:true,data:(records[table]||[]).filter(r=>Object.entries(params).every(([k,v])=>!String(v).startsWith('eq.')||r[k]===String(v).slice(3)))});
const request = (path, options) => guard(path, options, read);
test('PRUEBAS selects league per command, without channel categories or changing environment',async()=>{
 const {withLeagueOption}=require('../utils/leagueCommandOption');
 const command=withLeagueOption({name:'schedule',options:[{name:'torneo',type:3,required:true}]});
 assert.equal(command.options[1].name,'liga');
 assert.equal(withLeagueOption(command).options.length,2,'no duplicate selector');
 const values=await Promise.all(['ash','tematico','exclusivo'].map(liga=>scope.run({guildId:scope.TEST_GUILD,options:{getString:()=>liga}},async()=>{
  await new Promise(setImmediate);
  return (await request('torneos',{})).params.tipo;
 })));
 assert.deepEqual(values,['eq.ash','eq.tematico','eq.exclusivo']);
 assert.throws(()=>scope.run({guildId:ash,options:{getString:()=> 'tematico'}},()=>{}),/solo podés operar/);
});
test('unknown guild rejected; database guild context also scopes report approvals', async () => {
 assert.throws(()=>scope.run({guildId:'unknown'},()=>{}),/no está habilitado/);
 await assert.rejects(request('torneos',{method:'POST',body:{tipo:'ash'}}),/servidor autorizado/);
 await withGuild(ash,async()=> {
   assert.equal(scope.currentLeague(),'ash');
   await assert.rejects(request('torneos',{params:{tipo:'eq.tematico'}}),/solo podés/);
 });
});
test('own tournament writes allowed, cross league creation and reassignment rejected', async () => {
 await scope.run({guildId:ash},async()=>{
  await request('torneos',{method:'POST',body:{tipo:'ash',nombre:'A'}});
  await assert.rejects(request('torneos',{method:'POST',body:{tipo:'tematico'}}),/otra liga/);
  await assert.rejects(request('torneos',{method:'POST',body:{id:'t',tipo:'ash'}}),/otra liga/);
  await assert.rejects(request('torneos',{method:'PATCH',params:{id:'eq.a'},body:{tipo:'tematico'}}),/otra liga/);
  const edit=await request('torneos',{method:'PATCH',params:{id:'eq.a'},body:{nombre:'Renombrado'}});
  assert.equal(edit.params.tipo,'eq.ash');
 });
});
test('foreign fixtures, enrollments, RPC reports, and players rejected by ID', async () => {
 await scope.run({guildId:ash},async()=>{
  await assert.rejects(request('partidos',{method:'PATCH',params:{id:'eq.mt'},body:{jugado:true}}),/otra liga/);
  await assert.rejects(request('torneo_clubes',{method:'DELETE',params:{id:'eq.tc-t'}}),/otra liga/);
  await assert.rejects(request('partidos',{method:'POST',body:[{torneo_id:'t'}]}),/otra liga/);
  await assert.rejects(request('partidos',{method:'POST',body:[{id:'mt',torneo_id:'a'}]}),/otra liga/);
  await assert.rejects(request('rpc/publish_approved_report',{method:'POST',body:{p_match_id:'mt',p_stats:[]}}),/otra liga/);
  await assert.rejects(request('rpc/publish_approved_report',{method:'POST',body:{p_match_id:'ma',p_stats:[{jugador_id:'pt'}]}}),/otra liga/);
  await request('rpc/publish_approved_report',{method:'POST',body:{p_match_id:'ma',p_stats:[{jugador_id:'pa'}]}});
  await request('rpc/append_configured_tournament_fixture',{method:'POST',body:{p_tournament:'a',p_rows:[]}});
  await assert.rejects(request('rpc/append_configured_tournament_fixture',{method:'POST',body:{p_tournament:'a',p_rows:[{torneo_id:'t'}]}}),/otra liga/);
  await request('rpc/bot_delete_empty_tournament',{method:'POST',body:{p_id:'a',p_tipo:'ash'}});
  await assert.rejects(request('rpc/bot_delete_empty_tournament',{method:'POST',body:{p_id:'t',p_tipo:'ash'}}),/otra liga/);
  await assert.rejects(request('rpc/bot_delete_empty_tournament',{method:'POST',body:{p_id:'a',p_tipo:'tematico'}}),/otra liga/);
  const result=await request('partidos',{method:'PATCH',params:{id:'eq.ma'},body:{jugado:true}});
  assert.equal(result.params.and,'(torneo_id.in.(a))');
 });
});
test('shared catalog is immutable in league guilds; PRUEBAS can administer all leagues',async()=>{
 await scope.run({guildId:tem},async()=>{
  await assert.rejects(request('modalidades',{method:'DELETE',params:{id:'eq.x3'}}),/PRUEBAS/);
  await assert.rejects(request('tiers',{method:'DELETE',params:{modalidad_id:'eq.x3'}}),/PRUEBAS/);
  await assert.rejects(request('clubes',{method:'PATCH',params:{id:'eq.club'},body:{nombre:'X'}}),/PRUEBAS/);
  const reuse=await request('modalidades',{method:'POST',body:[{nombre:'x3',descripcion:null}],prefer:'resolution=merge-duplicates,return=representation'});
  assert.match(reuse.prefer,/ignore-duplicates/);
 });
 await scope.run({guildId:scope.TEST_GUILD},async()=>{
  await request('torneos',{method:'POST',body:[{tipo:'ash'},{tipo:'tematico'},{tipo:'exclusivo'}]});
  await request('rpc/publish_approved_report',{method:'POST',body:{p_match_id:'mt'}});
 });
});
