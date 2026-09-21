const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHostContext, hostReportField } = require('../utils/hostValidationContext');
test('host context rejects invented IP and does not infer Discord from IP', () => {
  assert.equal(normalizeHostContext({ reportedIp: 'No disponible' }).reportedIp, null);
  const session = { guildId: 'g', room: 'r', hostContext: { reportedIp: '192.0.2.1', version: '0.1.1' } };
  const field = hostReportField(session, [{ ip: '192.0.2.1', matchedUserId: '123' }], true);
  assert(!field.value.includes('<@123>'));
  assert(field.value.includes('192.0.2.1'));
  assert(!hostReportField(session, [], false).value.includes('192.0.2.1'));
});
test('only matching recent auth-confirmed owner references appear, never asserted as creator', () => {
  const session = { guildId: 'g', room: 'r', hostContext: { ownerValidationId: 'v' } };
  const owner = { guildId: 'g', room: 'r', validationId: 'v', status: 'confirmed', matchedBy: 'auth', matchedUserId: '123', confirmedAt: new Date().toISOString(), conn: 'private-conn' };
  assert(hostReportField(session, [owner], true).value.includes('<@123>'));
  assert(!hostReportField(session, [owner], false).value.includes('private-conn'));
  for (const change of [{ guildId: 'other' }, { room: 'other' }, { matchedBy: 'ip' }, { status: 'pending' }, { confirmedAt: '2020-01-01' }]) {
    assert(!hostReportField(session, [{ ...owner, ...change }], true).value.includes('<@123>'));
  }
});
