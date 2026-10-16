// -----------------------------------------------------------------------------
// Presence (src/presence.js): what makes a device seen, and the departure
// delay.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceTracker, collectClients } from '../src/presence.js';

const host = (mac, extra = {}) => ({
  mac,
  ip: '192.0.2.10',
  hostName: 'phone',
  ssid: null,
  segment: 'Bridge0',
  registered: true,
  denied: false,
  wifi: false,
  active: true,
  ...extra,
});

test('seen: an active host, or an authenticated station', () => {
  const clients = collectClients({
    hosts: [host('aa:00:00:00:00:01'), host('aa:00:00:00:00:02', { active: false })],
    stations: [
      { mac: 'aa:00:00:00:00:02', ap: 'WifiMaster0/AccessPoint0', authenticated: true },
      { mac: 'aa:00:00:00:00:03', ap: 'WifiMaster0/AccessPoint0', authenticated: false },
      { mac: 'aa:00:00:00:00:04', ap: 'WifiMaster1/AccessPoint0', authenticated: true },
    ],
  });
  assert.equal(clients.get('aa:00:00:00:00:01').seen, true);
  assert.equal(clients.get('aa:00:00:00:00:02').seen, true, 'associated, not yet active');
  assert.equal(clients.get('aa:00:00:00:00:02').wifi, true);
  assert.equal(clients.has('aa:00:00:00:00:03'), false, 'still in the handshake');
  assert.equal(clients.get('aa:00:00:00:00:04').registered, false);
  assert.equal(collectClients({ hosts: null, stations: null }).size, 0);
});

test('the departure delay counts from the last time the device was seen', () => {
  let now = 0;
  const tracker = new PresenceTracker({ awayDelayMs: 5 * 60_000, now: () => now });
  const seen = new Map([['m', { seen: true }]]);
  const gone = new Map();
  assert.deepEqual(tracker.update(['m', 'never'], seen), ['m']);
  assert.equal(tracker.presence('m'), 1);
  assert.equal(tracker.presence('never'), null, 'unknown until the delay passes');
  now = 4 * 60_000;
  assert.deepEqual(tracker.update(['m', 'never'], seen), []);
  assert.equal(tracker.presence('m'), 1);
  now = 6 * 60_000;
  assert.deepEqual(tracker.update(['m', 'never'], gone), ['never']);
  now = 9 * 60_000 + 1;
  assert.deepEqual(tracker.update(['m', 'never'], gone), ['m']);
  assert.equal(tracker.presence('m'), 0);
  assert.equal(tracker.get('m').since, now);
});
