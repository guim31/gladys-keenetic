// -----------------------------------------------------------------------------
// The configuration (src/config.js): the address typed by the user, the
// defaults, the values cleaned.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseAddress } from '../src/config.js';

test('the address: IP, name, port, URL copied from the browser, IPv6; never https', () => {
  assert.deepEqual(parseAddress('192.0.2.1'), { host: '192.0.2.1', port: null });
  assert.deepEqual(parseAddress(' my.keenetic.net '), { host: 'my.keenetic.net', port: null });
  assert.deepEqual(parseAddress('192.0.2.1:8080'), { host: '192.0.2.1', port: 8080 });
  assert.deepEqual(parseAddress('http://192.0.2.1/dashboard'), { host: '192.0.2.1', port: null });
  assert.deepEqual(parseAddress('[2001:db8::1]:81'), { host: '2001:db8::1', port: 81 });
  assert.equal(parseAddress('https://192.0.2.1'), null);
  assert.equal(parseAddress('ftp://192.0.2.1'), null);
  assert.equal(parseAddress('http://admin:pw@192.0.2.1'), null, 'no credentials in the address');
  assert.equal(parseAddress(''), null);
  assert.equal(parseAddress(42), null);
});

test('the defaults of an empty configuration', () => {
  assert.deepEqual(normalizeConfig({}), {
    host: null,
    port: null,
    invalidHost: false,
    username: '',
    password: '',
    pollIntervalMs: 30_000,
    awayDelayMs: 5 * 60_000,
    guestSegment: null,
    invalidGuest: false,
    allowCommands: false,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.allow_commands, false);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('typed values are cleaned: numbers as strings, bounds, unknown options', () => {
  const config = normalizeConfig({
    host: 'http://192.0.2.1:8080/',
    username: ' gladys ',
    password: ' spaces kept ',
    poll_interval: '7',
    away_delay: '2,6',
    guest_segment: 'bridge 1',
    allow_commands: 'true',
    language: 'it',
  });
  assert.equal(config.host, '192.0.2.1');
  assert.equal(config.port, 8080);
  assert.equal(config.username, 'gladys');
  assert.equal(config.password, ' spaces kept ');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.awayDelayMs, 3 * 60_000);
  assert.equal(config.guestSegment, 'Bridge1');
  assert.equal(config.allowCommands, true);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ away_delay: 500 }).awayDelayMs, 60 * 60_000);
  assert.equal(normalizeConfig({ away_delay: -1 }).awayDelayMs, 5 * 60_000);
  assert.equal(normalizeConfig({ poll_interval: 10 }).pollIntervalMs, 10_000);
});

test('an address or a guest segment that cannot be used is flagged', () => {
  assert.equal(normalizeConfig({ host: 'https://192.0.2.1' }).invalidHost, true);
  const guest = normalizeConfig({ guest_segment: 'Guest network' });
  assert.equal(guest.guestSegment, null);
  assert.equal(guest.invalidGuest, true);
});
