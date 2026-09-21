const { test } = require('node:test');
const assert = require('node:assert/strict');
const state = require('../utils/supabaseState');
const db = require('../utils/database');
const { isCaptain } = require('../utils/clubPermissions');

test('same player and club: signing/captain changes in ASH do not modify RTG', async () => {
  const docs = { config: {}, users: { guilds: {} } };
  const get = state.getDoc, set = state.setDoc;
  state.getDoc = key => structuredClone(docs[key] || {});
  state.setDoc = (key, value) => { docs[key] = structuredClone(value); };
  const ash = '1293616776747286631', rtg = '1400962843674804264';
  try {
    await Promise.all([ash, rtg].map(guild => db.withGuild(guild, async () => {
      await new Promise(setImmediate);
      db.upsertUserClubAffiliation('pepito123', { club: 'Club A', modality: 'x3', roleId: guild + '-role' });
      const config = db.readConfig();
      config.clubs['Club A'] = { captains: { x3: guild + '-captain' } };
      db.saveConfig(config);
    })));
    db.withGuild(ash, () => {
      assert.equal(db.getUserClubAffiliationForModality('pepito123', 'x3').roleId, ash + '-role');
      assert.ok(isCaptain(db.readConfig(), 'Club A', 'x3', ash + '-captain'));
      db.removeUserClubAffiliation('pepito123', { club: 'Club A', modality: 'x3' });
      assert.equal(db.getUserClubAffiliationForModality('pepito123', 'x3'), null);
    });
    db.withGuild(rtg, () => {
      assert.equal(db.getUserClubAffiliationForModality('pepito123', 'x3').roleId, rtg + '-role');
      assert.ok(isCaptain(db.readConfig(), 'Club A', 'x3', rtg + '-captain'));
      assert.equal(isCaptain(db.readConfig(), 'Club A', 'x3', ash + '-captain'), false);
    });
  } finally { state.getDoc = get; state.setDoc = set; }
});
