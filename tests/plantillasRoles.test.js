const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../utils/database');
const { renderClubTemplate, reconcileClubRosterFromRoles, reconcileForumTemplate, syncMemberClubRoles, updateLinkedForumTemplates, pruneMissingForumClubLinks, auditLinkedForumTemplates } = require('../utils/plantillas');

const member = id => ({ id, roles: { cache: new Map([['club-role', true]]) }, user: { username: id } });

test('la plantilla refleja exactamente los miembros del rol y solo edita al cambiar', async () => {
  const members = new Map(['a', 'b', 'c', 'd'].map(id => [id, member(id)]));
  const role = { id: 'club-role', members };
  const guild = {
    id: 'plantilla-role-test', client: { user: { id: 'bot' } },
    members: { cache: members, fetch: async () => members },
    roles: { cache: new Map([['club-role', role]]), fetch: async () => role },
    channels: { fetch: async () => null }
  };
  await database.withGuild(guild.id, async () => {
    const cfg = database.readConfig();
    cfg.clubs = { Azul: { name: 'Azul', roles: { x3: 'club-role' }, captains: {} } };
    cfg.forumClubs = {};
    database.saveConfig(cfg);
    database.saveUsers({ a: { clubRoles: { x3: 'club-role' } }, fantasma: { clubRoles: { x3: 'club-role' } } });
    const club = { name: 'Azul', roles: { x3: 'club-role' }, captains: {} };
    const first = await renderClubTemplate(guild, club, 'x3');
    assert.match(first, /4\/4/);
    for (const id of members.keys()) assert.match(first, new RegExp(`<@${id}>`));
    assert.doesNotMatch(first, /fantasma/);

    let edits = 0;
    const message = { id: '123', content: first, author: { id: 'bot' }, edit: async ({ content }) => { edits++; message.content = content; } };
    const channel = { id: 'foro', messages: { fetch: async arg => typeof arg === 'string' ? message : new Map([['123', message]]) } };
    await reconcileForumTemplate(guild, channel, club, 'x3', { preferredMessageId: '123' });
    assert.equal(edits, 0);
    members.delete('d');
    await reconcileForumTemplate(guild, channel, club, 'x3', { preferredMessageId: '123' });
    assert.equal(edits, 1);
    assert.match(message.content, /3\/3/);
    assert.doesNotMatch(message.content, /<@d>/);

    const result = await reconcileClubRosterFromRoles(guild, club, 'x3');
    assert.equal(result.roleCount, 3);
    assert.equal(database.readUsers(guild.id).fantasma.clubRoles?.x3, undefined);
    await syncMemberClubRoles(guild, member('d'), []);
    assert.equal(database.readUsers(guild.id).d.clubRoles.x3, 'club-role');
  });
});

test('una carga incompleta no elimina a nadie del registro', async () => {
  const guild = { id: 'plantilla-timeout-test', members: { fetch: async () => { throw Error('GuildMembersTimeout'); } }, roles: { cache: new Map(), fetch: async () => null } };
  await database.withGuild(guild.id, async () => {
    database.saveUsers({ jugador: { clubRoles: { x3: 'club-role' } } });
    await assert.rejects(reconcileClubRosterFromRoles(guild, { name: 'Azul', roles: { x3: 'club-role' } }, 'x3'), /GuildMembersTimeout/);
    assert.equal(database.readUsers(guild.id).jugador.clubRoles.x3, 'club-role');
  });
});

test('un error temporal al consultar el foro conserva su vínculo', async () => {
  const guild = { id: 'forum-transient-test', channels: { fetch: async () => { throw Error('temporary network error'); } } };
  await database.withGuild(guild.id, async () => {
    const cfg = database.readConfig();
    cfg.clubs = { Azul: { name: 'Azul', roles: { x3: 'club-role' } } };
    cfg.forumClubs = { foro: { guildId: guild.id, club: 'Azul', modality: 'x3', messageId: '123' } };
    database.saveConfig(cfg);
    await updateLinkedForumTemplates(guild, 'Azul', 'x3');
    assert.deepEqual(await pruneMissingForumClubLinks(guild), []);
    assert.equal((await auditLinkedForumTemplates(guild)).skipped, 1);
    assert.ok(database.readConfig().forumClubs.foro);
  });
});
