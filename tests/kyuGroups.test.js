const {test}=require('node:test'),assert=require('node:assert/strict'),{createGroups}=require('../utils/kyu-backend/groups.cjs');
function fixture(){const db={users:{a:{username:'A'},b:{username:'B'},c:{username:'C'}},friends:[{from:'a',to:'b',accepted:true},{from:'a',to:'c',accepted:false}]};let time=1,saves=0;const api=createGroups(db,()=>saves++,()=>time);return {db,api,expire:()=>time+=300001,saves:()=>saves};}
test('leader room destination is scoped, validated, expires and clears on succession',()=>{
 const {api,expire}=fixture(),id=api.run('a','create').group.id;api.run('a','invite',{id:'b'});api.run('b','join',{groupId:id});
 assert.throws(()=>api.run('b','room',{url:'https://www.haxball.com/play?c=abcdef'}));assert.throws(()=>api.run('a','room',{url:'https://evil.invalid/play?c=abcdef'}));
 const room=api.run('a','room',{url:'https://haxball.com/play?c=abcdef'}).group.room;assert.equal(room.url,'https://www.haxball.com/play?c=abcdef');assert.equal(api.run('b','state').group.room.event,room.event);assert.equal(api.run('c','state').group,null);
 expire();assert.equal(api.run('b','state').group.room,null);api.run('a','room',{url:room.url});api.run('a','leave');assert.equal(api.run('b','state').group.room,null);
});
test('only leader removes a member; removal revokes access and invitation reuse',()=>{
 const {api}=fixture(),id=api.run('a','create').group.id;
 api.run('a','invite',{id:'b'});api.run('b','join',{groupId:id});
 assert.throws(()=>api.run('b','remove',{id:'a'}));assert.throws(()=>api.run('c','remove',{id:'b'}));
 assert.throws(()=>api.run('a','remove',{id:'a'}));assert.throws(()=>api.run('a','remove',{id:'c'}));
 api.run('a','remove',{id:'b'});assert.equal(api.run('b','state').group,null);
 assert.throws(()=>api.run('b','join',{groupId:id}));assert.equal(api.run('a','state').group.members.length,1);
});
test('invite controls reflect authenticated leadership and succession',()=>{
 const {api}=fixture();assert.equal(api.run('a','state').canInvite,false);
 const group=api.run('a','create').group;assert.equal(api.run('a','state').canInvite,true);
 api.run('a','invite',{id:'b'});api.run('b','join',{groupId:group.id});
 assert.equal(api.run('b','state').canInvite,false);api.run('a','leave');
 assert.equal(api.run('a','state').canInvite,false);assert.equal(api.run('b','state').canInvite,true);
});
test('create, accepted-friend invitation, join, leader succession and final cleanup persist',()=>{const f=fixture(),group=f.api.run('a','create').group;f.api.run('a','invite',{id:'b'});assert.equal(f.api.run('b','state').invitations[0].id,group.id);f.api.run('b','join',{groupId:group.id});assert.equal(f.api.run('a','state').group.members.length,2);f.api.run('a','leave');assert.equal(f.api.run('b','state').group.leader,'b');f.api.run('b','leave');assert.equal(Object.keys(f.db.groups).length,0);assert.equal(f.saves(),5);});
test('nonfriends, nonleaders, forged invitations and expired invitations rejected',()=>{const f=fixture(),group=f.api.run('a','create').group;assert.throws(()=>f.api.run('a','invite',{id:'c'}));assert.throws(()=>f.api.run('b','invite',{id:'a'}));assert.throws(()=>f.api.run('b','join',{groupId:group.id}));f.api.run('a','invite',{id:'b'});f.expire();assert.throws(()=>f.api.run('b','join',{groupId:group.id}));assert.equal(f.api.run('b','state').invitations.length,0);});
test('group membership and invitations survive service reconstruction without leaking others groups',()=>{const f=fixture(),id=f.api.run('a','create').group.id;f.api.run('a','invite',{id:'b'});const restored=createGroups(JSON.parse(JSON.stringify(f.db)),()=>{},()=>1);assert.equal(restored.run('a','state').group.id,id);assert.equal(restored.run('c','state').group,null);assert.deepEqual(restored.run('c','state').invitations,[]);restored.run('b','join',{groupId:id});assert.throws(()=>restored.run('b','create'));});
test('decline, removed friendship and leader departure invalidate invitations',()=>{const f=fixture(),id=f.api.run('a','create').group.id;f.api.run('a','invite',{id:'b'});f.api.run('b','decline',{groupId:id});assert.throws(()=>f.api.run('b','join',{groupId:id}));f.api.run('a','invite',{id:'b'});f.db.friends=[];assert.throws(()=>f.api.run('b','join',{groupId:id}));f.api.run('a','leave');assert.equal(f.api.run('b','state').invitations.length,0);});
test('search starts without a minimum party, expands its PR range and pairs compatible full groups',()=>{const f=fixture(),first=f.api.run('a','create').group.id;f.api.run('a','modes',{modes:['x3']});const waiting=f.api.run('a','search').group.search;assert.equal(waiting.minimum,2);assert.equal(waiting.range,50);f.expire();assert.ok(f.api.run('a','state').group.search.range>50);f.api.run('a','invite',{id:'b'});f.api.run('b','join',{groupId:first});assert.equal(f.api.run('a','state').group.search.matched,false);});
test('HTTP group routes use authenticated identity, not a supplied leader ID',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events'),{hash}=require('../utils/kyu-backend/access.cjs'),{createService}=require('../utils/kyu-backend/server.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyu-groups-')),file=path.join(dir,'db.json'),f=fixture();f.db.accessSessions={};for(const id of ['a','b','c'])f.db.accessSessions[hash('test-'+id)]={id,expires:Date.now()+60000};fs.writeFileSync(file,JSON.stringify(f.db));
 const service=createService({DATA_FILE:file,DISCORD_CLIENT_ID:'test',DISCORD_CLIENT_SECRET:'test',DISCORD_BOT_TOKEN:'test',DISCORD_GUILD_ID:'test',KYU_PLAYER_ROLE_ID:'player',PUBLIC_URL:'https://test.invalid'},async()=>({ok:true,status:200,json:async()=>({user:{username:'QA'},roles:['player']})}));service.start(0);await once(service.server,'listening');t.after(()=>service.close());const base='http://127.0.0.1:'+service.server.address().port;
 async function call(id,action,data={}){return (await fetch(base+'/v1/groups/'+action,{method:'POST',headers:{Authorization:'Bearer test-'+id,'Content-Type':'application/json'},body:JSON.stringify(data)})).json();}
 assert.equal((await call('invalid','create')).ok,false);const group=(await call('a','create')).group;assert.equal(group.leader,'a');assert.equal((await call('b','invite',{id:'c',leader:'a'})).ok,false);await call('a','invite',{id:'b'});assert.equal((await call('c','join',{groupId:group.id,id:'b'})).ok,false);assert.equal((await call('b','join',{groupId:group.id})).group.members.length,2);assert.equal(JSON.parse(fs.readFileSync(file)).groups[group.id].members.length,2);
 const friends=async()=> (await (await fetch(base+'/v1/friends/list',{headers:{Authorization:'Bearer test-a'}})).json()).friends;
 assert.equal((await friends()).find(f=>f.id==='b').online,false);
 await fetch(base+'/v1/heartbeat',{method:'POST',headers:{Authorization:'Bearer test-b'}});
 assert.equal((await friends()).find(f=>f.id==='b').online,true);
 assert.equal((await friends()).find(f=>f.id==='c').online,false);
 assert.equal((await call('a','state')).self.id,'a');
 await call('a','room',{url:'https://www.haxball.com/play?c=abcdef'});
 const beat=await (await fetch(base+'/v1/heartbeat',{method:'POST',headers:{Authorization:'Bearer test-b'}})).json();assert.equal(beat.groupState.group.room.url,'https://www.haxball.com/play?c=abcdef');assert.equal(beat.groupState.self.id,'b');
 await call('a','room',{url:null});assert.equal((await call('b','state')).group.room,null);
 await fetch(base+'/v1/logout',{method:'POST',headers:{Authorization:'Bearer test-a'}});assert.equal((await call('b','state')).group.leader,'b');
});
