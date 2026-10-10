const {test}=require('node:test'),assert=require('node:assert/strict'),{createGroups}=require('../utils/kyu-backend/groups.cjs');
test('leader succession follows continuous membership age, including rejoin and manual transfer',()=>{
 const db={users:{a:{},b:{},c:{},d:{}},friends:[['a','b'],['a','c'],['a','d'],['c','d']].map(([from,to])=>({from,to,accepted:true}))};
 const api=createGroups(db,()=>{}),id=api.run('a','create').group.id;
 for(const member of ['b','c','d']){api.run('a','invite',{id:member});api.run(member,'join',{groupId:id});}
 api.run('b','leave');api.run('a','invite',{id:'b'});api.run('b','join',{groupId:id});
 api.run('a','leave');assert.equal(api.run('c','state').group.leader,'c');
 api.run('c','leader',{id:'b'});api.run('b','leave');assert.equal(api.run('c','state').group.leader,'c');
 api.run('c','leave');assert.equal(api.run('d','state').group.leader,'d');
 api.run('d','leave');assert.equal(Object.keys(db.groups).length,0);
});
test('seven members maximum, roles validated, modes restricted, PR server-owned',()=>{
 const db={users:{},friends:[],playerPR:{a:400,b:600}};
 for(const id of 'abcdefgh'){db.users[id]={username:id};if(id!=='a')db.friends.push({from:'a',to:id,accepted:true});}
 const api=createGroups(db,()=>{}),id=api.run('a','create').group.id;
 for(const member of 'bcdefg'){api.run('a','invite',{id:member});api.run(member,'join',{groupId:id});}
 assert.throws(()=>api.run('a','invite',{id:'h'}),/7/);
 assert.throws(()=>api.run('b','hoster',{id:'b'}));
 assert.throws(()=>api.run('a','hoster',{id:'h'}));
 assert.equal(api.run('a','hoster',{id:'b'}).group.hoster,'b');
 assert.equal(api.run('b','room',{url:'https://www.haxball.com/play?c=abcdef'}).group.room.by,'b');
 assert.throws(()=>api.run('b','modes',{modes:['x3']}));
 for(const modes of [['x3','x4','big'],['x3','x3'],['evil']])assert.throws(()=>api.run('a','modes',{modes}));
 assert.deepEqual(api.run('a','modes',{modes:['big','rsx4']}).group.modes,['big','rsx4']);
 assert.equal(api.run('a','state',{pr:999}).self.pr,400);
 assert.equal(api.run('a','state').group.pr,Math.round((400+600)/7)); // Unranked members start at 0; never accept client PR.
 api.run('a','remove',{id:'b'});assert.equal(api.run('a','state').group.hoster,'a');
 api.run('a','leader',{id:'c'});assert.throws(()=>api.run('a','remove',{id:'c'}));
});
