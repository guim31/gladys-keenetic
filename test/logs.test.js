// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password, its hash, the challenge nor the
// session cookie, even at debug. (Adapted from guim31/gladys-openwrt.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeAnswer } from '../src/keenetic/rci.js';
import {
  FakeKeenetic,
  PASSWORD,
  baseConfig,
  createAll,
  createWorld,
  later,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return { lines, clear: () => lines.splice(0), texts: () => lines.map((line) => line.text) };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('connected (KeeneticOS 4.1.7')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.router.traffic('PPPoE0', 1_000_000 * i, 100_000);
    w.router.setCpu(10 + i);
    w.router.connectHost('00:00:5e:00:53:20', { ap: 'WifiMaster1/AccessPoint0' });
    w.router.disconnectHost('00:00:5e:00:53:20');
    if (i === 2) {
      w.router.expireSessions(); // a new login is not an event either
    }
    await later(w, 10);
  }
  assert.deepEqual(logs.texts(), []);
});

test('a router that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.router.goOffline();
  for (let i = 0; i < 6; i += 1) {
    await later(w, 1);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.router.goOnline();
  await later(w, 1);
  await later(w, 1);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /connection restored/);
});

test('a refused password is logged once and never written', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: baseConfig({ password: 'wrong-password-123' }) });
  for (let i = 0; i < 5; i += 1) {
    await later(w, 6);
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.ok(!logs.texts().join('\n').includes('wrong-password-123'));
});

test('a reading the user may not do is one warning, not one per reading', async (t) => {
  const logs = captureLogs(t);
  const device = new FakeKeenetic({
    users: { gladys: { password: PASSWORD, deny: ['show/associations'] } },
  });
  const w = await world(t, { device });
  for (let i = 0; i < 5; i += 1) {
    await later(w, 1);
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.deepEqual(
    warnings.map((line) => /show associations not readable \(permission\)/.test(line.text)),
    [true],
  );
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.router.setCpu(20 + i);
    await later(w, 1);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('one line per user command, one per transition of the Internet', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  logs.clear();
  await w.fake.sceneAction('enable_guest_wifi', {});
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Guest Wi-Fi Bridge1 enabled/);
  logs.clear();
  w.router.setConnected('PPPoE0', false);
  w.router.setInternet(true, 'UsbLte0');
  await later(w, 1);
  await later(w, 1);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.texts()[0], /backup connection/);
});

test('LOG_LEVEL=debug shows each problem; no password, hash, challenge nor cookie, ever', async (t) => {
  const logs = captureLogs(t, 'debug');
  const device = new FakeKeenetic({
    users: { gladys: { password: PASSWORD } },
    identification: false,
  });
  const challenges = [];
  const handle = device.handle.bind(device);
  device.handle = (url, options) => {
    const answer = handle(url, options);
    if (answer.headers['x-ndm-challenge']) {
      challenges.push(answer.headers['x-ndm-challenge']);
    }
    return answer;
  };
  const w = await world(t, { device, config: baseConfig({ allow_commands: true }) });
  await createAll(w);
  w.router.goOffline();
  await later(w, 1);
  await later(w, 1);
  w.router.goOnline();
  w.router.expireSessions();
  await later(w, 1);
  await w.fake.action('test_connection', {});
  await w.fake.sceneAction('disable_guest_wifi', {});
  await w.fake.sceneAction('block_device_internet', {
    device: w.gladys.externalIds('client', '00:00:5e:00:53:24').device,
  });
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes(PASSWORD), 'never the password');
  assert.ok(challenges.length >= 2);
  for (const challenge of challenges) {
    assert.ok(!text.includes(challenge), 'never a challenge');
    assert.ok(
      !text.includes(challengeAnswer('gladys', device.realm, PASSWORD, challenge)),
      'never the answer to a challenge',
    );
  }
  for (const cookie of device.cookies.keys()) {
    assert.ok(!text.includes(cookie.split('=')[1]), 'never a session cookie');
  }
  assert.ok(!text.includes(w.hub.client?.session.cookie?.split('=')[1] ?? 'none'));
});
