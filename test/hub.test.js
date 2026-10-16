// -----------------------------------------------------------------------------
// The hub against the fake Keenetic: discovery, states, presence, the scene
// events, the commands and the failures of the router.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeKeenetic,
  PASSWORD,
  baseConfig,
  createAll,
  createClock,
  createWorld,
  fullUser,
  ids,
  later,
  readOnlyUser,
} from './helpers/world.js';

const CAMILLE = '00:00:5e:00:53:20';
const NAS = '00:00:5e:00:53:21';
const TABLET = '00:00:5e:00:53:22';
const DOMINIQUE = '00:00:5e:00:53:23';
const ESP = '00:00:5e:00:53:24';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const routerFeature = (w, key) => ids(w.gladys).router().feature(key);
const presenceOf = (w, mac) => w.fake.lastState(ids(w.gladys).client(mac).feature('presence'));

test('discovery: the router, then the network devices, registered ones first', async (t) => {
  const w = await world(t);
  const [router, ...clients] = w.fake.discoveredDevices;
  assert.equal(router.name, 'Keenetic Giga');
  assert.equal(router.external_id, ids(w.gladys).router().device);
  assert.equal(router.should_poll, false);
  assert.deepEqual(
    clients.map((device) => device.name),
    ['Camille', 'NAS', 'Tablette des enfants', 'Dominique', 'ESP-1A2B3C'],
  );
  assert.deepEqual(clients[0].params, [
    { name: 'MAC_ADDRESS', value: CAMILLE },
    { name: 'IP_ADDRESS', value: '192.0.2.20' },
  ]);
  // A station still in the handshake is no device of the network.
  assert.ok(!clients.some((device) => device.external_id.endsWith('00:00:5e:00:53:25')));
});

test('the router id: the MAC address of the home segment, else show identification', async (t) => {
  const device = new FakeKeenetic({ users: fullUser() });
  device.data['show/identification'].mac = '00:00:5e:00:53:0a';
  const w = await world(t, { device });
  assert.equal(w.fake.discoveredDevices[0].external_id, ids(w.gladys).router().device);

  const noBridge = new FakeKeenetic({ users: fullUser() });
  delete noBridge.data['show/interface'].Bridge0;
  noBridge.data['show/identification'].mac = '00:00:5e:00:53:0a';
  const other = await world(t, { device: noBridge });
  assert.equal(
    other.fake.discoveredDevices[0].external_id,
    ids(other.gladys).router('00-00-5e-00-53-0a').device,
  );
});

test('states: published for the added devices only, then only when they change', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0, 'nothing before the devices are added');
  await createAll(w);
  assert.equal(w.fake.lastState(routerFeature(w, 'cpu_load')), 7);
  assert.equal(w.fake.lastState(routerFeature(w, 'memory_usage')), 23);
  assert.equal(w.fake.lastState(routerFeature(w, 'uptime')), 96);
  assert.equal(w.fake.lastState(routerFeature(w, 'firmware_version')), '4.1.7');
  assert.equal(w.fake.lastState(routerFeature(w, 'internet')), 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'active_connection')), 'Fibre');
  assert.equal(w.fake.lastState(routerFeature(w, 'backup_active')), 0);
  assert.equal(w.fake.lastState(routerFeature(w, 'backup_link')), 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'wifi_clients')), 3);
  assert.equal(w.fake.lastState(routerFeature(w, 'connected_devices')), 4);
  assert.equal(w.fake.lastState(routerFeature(w, 'guest_wifi')), 0);
  assert.equal(presenceOf(w, CAMILLE), 1);
  const count = w.fake.states.length;
  await later(w, 1);
  const sent = w.fake.states.slice(count).map((state) => state.device_feature_external_id);
  // The rates appear (two readings of the counters); nothing else changed.
  assert.deepEqual(sent.sort(), [routerFeature(w, 'wan_download'), routerFeature(w, 'wan_upload')]);
  w.router.setCpu(55);
  await later(w, 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'cpu_load')), 55);
});

test('rates: the counters of the connection in use, in Mbit/s', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.router.traffic('PPPoE0', 75_000_000, 7_500_000);
  await later(w, 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'wan_download')), 10);
  assert.equal(w.fake.lastState(routerFeature(w, 'wan_upload')), 1);
  // A counter that went back (new PPPoE session): no rate this time.
  w.router.data['show/interface/stat'].PPPoE0.rxbytes = 1000;
  const count = w.fake.states.length;
  await later(w, 1);
  assert.ok(
    !w.fake.states
      .slice(count)
      .some((state) => state.device_feature_external_id === routerFeature(w, 'wan_download')),
  );
});

test('a heartbeat publishes an unchanged value again, a present device more often', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = (id) => w.fake.states.filter((s) => s.device_feature_external_id === id).length;
  const cpu = routerFeature(w, 'cpu_load');
  const presence = ids(w.gladys).client(CAMILLE).feature('presence');
  const [cpuBefore, presenceBefore] = [count(cpu), count(presence)];
  for (let i = 0; i < 6; i += 1) {
    await later(w, 1);
  }
  assert.equal(count(cpu), cpuBefore, 'unchanged within 6 minutes');
  assert.ok(count(presence) >= presenceBefore + 2, 'present again every 2 minutes');
  await later(w, 6 * 60);
  assert.equal(count(cpu), cpuBefore + 1, 'again after 6 hours');
});

test('presence: a departure counts after the delay, an outage of the router changes nothing', async (t) => {
  const w = await world(t, { config: baseConfig({ away_delay: 5 }) });
  await createAll(w);
  assert.equal(presenceOf(w, CAMILLE), 1);
  w.router.disconnectHost(CAMILLE);
  await later(w, 3);
  assert.equal(presenceOf(w, CAMILLE), 1, 'still present within the delay');
  await later(w, 3);
  assert.equal(presenceOf(w, CAMILLE), 0);
  // Never seen since the start: away once the delay has passed.
  assert.equal(presenceOf(w, DOMINIQUE), 0);

  w.router.goOffline();
  await later(w, 30);
  assert.equal(presenceOf(w, NAS), 1, 'the household is not sent away');
  w.router.goOnline();
  w.router.connectHost(CAMILLE, { ap: 'WifiMaster1/AccessPoint0' });
  await later(w, 1);
  assert.equal(presenceOf(w, CAMILLE), 1);
});

test('presence: a wired device and a Wi-Fi station the host table does not have yet', async (t) => {
  const w = await world(t);
  await createAll(w);
  assert.equal(presenceOf(w, NAS), 1, 'wired, active in the host table');
  w.router.associate('00:00:5e:00:53:30', 'WifiMaster0/AccessPoint0');
  await w.hub.rediscover();
  const fresh = w.fake.discoveredDevices.find((d) => d.external_id.endsWith('00:00:5e:00:53:30'));
  assert.ok(fresh, 'an associated station is listed');
  await w.fake.deviceCreated(fresh);
  assert.equal(presenceOf(w, '00:00:5e:00:53:30'), 1);
});

test('a device added in Gladys gets its values at once, and the widget is refreshed', async (t) => {
  const w = await world(t);
  const tablet = w.fake.discoveredDevices.find((d) => d.name === 'Tablette des enfants');
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.deviceCreated(tablet);
  assert.equal(presenceOf(w, TABLET), 1);
  assert.ok(w.fake.widgetRefreshes.length > refreshes);
});

test('unknown device: the first reading learns the network, a new MAC fires once', async (t) => {
  const w = await world(t);
  assert.equal(events(w, 'unknown_device_connected').length, 0);
  w.router.connectHost('00:00:5e:00:53:40', { ap: 'WifiMaster0/AccessPoint0', name: 'Visitor' });
  await later(w, 1);
  await later(w, 1);
  const [event] = events(w, 'unknown_device_connected');
  assert.deepEqual(event.data, {
    mac: '00:00:5e:00:53:40',
    ip: '192.0.2.99',
    host_name: 'Visitor',
    network: 'home',
    connection: 'wifi',
    ssid: 'Maison',
  });
  assert.equal(events(w, 'unknown_device_connected').length, 1);

  // Known after a restart too (/data): only the really new one fires.
  await w.app.stop();
  const again = await world(t, { device: w.router, dataDir: w.dataDir, clock: w.clock });
  w.router.connectHost('00:00:5e:00:53:41');
  await later(again, 1);
  assert.deepEqual(
    events(again, 'unknown_device_connected').map((e) => e.data.mac),
    ['00:00:5e:00:53:41'],
  );
});

test('unknown device: a wired one on the guest segment, at most five per reading', async (t) => {
  const w = await world(t);
  const host = w.router.connectHost('00:00:5e:00:53:50');
  host.interface = { id: 'Bridge1', name: 'Guest', description: 'Guest network' };
  for (let i = 0; i < 8; i += 1) {
    w.router.connectHost(`00:00:5e:00:53:6${i}`);
  }
  await later(w, 1);
  const fired = events(w, 'unknown_device_connected');
  assert.equal(fired.length, 5);
  assert.equal(fired[0].data.network, 'guest');
  assert.equal(fired[0].data.connection, 'wired');
});

test('Internet down and restored: one event each, with the length of the outage', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.router.setConnected('PPPoE0', false);
  w.router.setConnected('UsbLte0', false);
  w.router.setInternet(false, null);
  await later(w, 1);
  await later(w, 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'internet')), 0);
  assert.equal(w.fake.lastState(routerFeature(w, 'active_connection')), 'None');
  assert.deepEqual(
    events(w, 'internet_down').map((e) => e.data),
    [{ connection: 'Fibre' }],
  );
  w.router.setConnected('PPPoE0', true);
  w.router.setInternet(true, 'PPPoE0');
  await later(w, 10);
  assert.deepEqual(
    events(w, 'internet_up').map((e) => e.data),
    [{ connection: 'Fibre', down_minutes: 11 }],
  );
  assert.equal(events(w, 'backup_connection_active').length, 0);
});

test('failover to the 4G backup and back: one event each, with the time on the backup', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.router.setConnected('PPPoE0', false);
  w.router.setInternet(true, 'UsbLte0');
  w.router.traffic('UsbLte0', 7_500_000, 750_000);
  await later(w, 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'backup_active')), 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'active_connection')), '4G backup');
  assert.deepEqual(
    events(w, 'backup_connection_active').map((e) => e.data),
    [{ connection: '4G backup', primary: 'Fibre' }],
  );
  assert.equal(events(w, 'internet_down').length, 0, 'Internet never went down');
  w.router.traffic('UsbLte0', 7_500_000, 750_000);
  await later(w, 1);
  assert.equal(w.fake.lastState(routerFeature(w, 'wan_download')), 1, 'the rates follow the 4G');

  w.router.setConnected('PPPoE0', true);
  w.router.setInternet(true, 'PPPoE0');
  await later(w, 20);
  assert.equal(w.fake.lastState(routerFeature(w, 'backup_active')), 0);
  assert.deepEqual(
    events(w, 'primary_connection_restored').map((e) => e.data),
    [{ connection: 'Fibre', backup_minutes: 21 }],
  );
});

test('a router with one connection has no backup features; a VPN is not a backup', async (t) => {
  const device = new FakeKeenetic({ fixture: 'ultra-5.1-wireguard', users: fullUser() });
  const w = await world(t, { device });
  const [router] = w.fake.discoveredDevices;
  const keys = router.features.map((f) => f.external_id.split(':').pop());
  assert.ok(!keys.includes('backup_active') && !keys.includes('backup_link'));
  await createAll(w);
  // The Internet goes through Wireguard3; the connection in use is the ISP one.
  assert.equal(w.fake.lastState(routerFeature(w, 'active_connection')), 'Fibre');
});

test('a refused password is not tried again at every reading', async (t) => {
  const w = await world(t, { config: baseConfig({ password: 'wrong-password-123' }) });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused/);
  for (let i = 0; i < 4; i += 1) {
    await later(w, 1);
  }
  assert.equal(w.router.logins.failed, 1);
  await later(w, 5);
  assert.equal(w.router.logins.failed, 2);
});

test('a session expired on the router is renewed without an outage', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.router.expireSessions();
  await later(w, 1);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.router.logins.ok, 2);
});

test('a user that may not read the host table: the gap is reported, the rest works', async (t) => {
  const device = new FakeKeenetic({
    users: { gladys: { password: PASSWORD, deny: ['show/ip/hotspot', 'show/associations'] } },
  });
  const w = await world(t, { device });
  await createAll(w);
  const [router] = w.fake.discoveredDevices;
  const keys = router.features.map((f) => f.external_id.split(':').pop());
  assert.ok(!keys.includes('connected_devices') && !keys.includes('wifi_clients'));
  assert.equal(w.fake.lastState(routerFeature(w, 'internet')), 1);
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Not readable: show ip hotspot, show associations/);
});

test('commands are off by default', async (t) => {
  const w = await world(t);
  for (const key of ['enable_guest_wifi', 'reboot_router']) {
    const ack = await w.fake.sceneAction(key, {});
    assert.equal(ack.success, false);
    assert.match(ack.error, /Allow commands/);
  }
  assert.equal(w.router.calls.filter((c) => c.user).length, 0, 'nothing sent');
});

test('guest Wi-Fi: on and off through its access points, saved, its state follows', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  await createAll(w);
  let ack = await w.fake.sceneAction('enable_guest_wifi', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { enabled: true });
  assert.deepEqual(
    w.router.calls.filter((c) => c.path === 'interface').map((c) => c.args),
    [
      { name: 'WifiMaster0/AccessPoint1', up: true },
      { name: 'WifiMaster1/AccessPoint1', up: true },
    ],
  );
  assert.equal(w.router.saves, 1, 'the configuration is saved');
  assert.equal(w.fake.lastState(routerFeature(w, 'guest_wifi')), 1);
  ack = await w.fake.sceneAction('disable_guest_wifi', {});
  assert.deepEqual(ack.data.outputs, { enabled: false });
  assert.equal(w.fake.lastState(routerFeature(w, 'guest_wifi')), 0);
  assert.equal(w.router.data['show/interface']['WifiMaster0/AccessPoint1'].state, 'down');
});

test('guest Wi-Fi: a segment chosen by hand, one that does not exist, a read-only user', async (t) => {
  const w = await world(t, {
    config: baseConfig({ allow_commands: true, guest_segment: 'bridge 0' }),
  });
  await w.fake.sceneAction('disable_guest_wifi', {});
  assert.equal(w.router.data['show/interface']['WifiMaster0/AccessPoint0'].state, 'down');

  const missing = await world(t, {
    config: baseConfig({ allow_commands: true, guest_segment: 'Bridge7' }),
  });
  const ack = await missing.fake.sceneAction('enable_guest_wifi', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /does not exist/);

  const device = new FakeKeenetic({ users: readOnlyUser() });
  const readOnly = await world(t, { device, config: baseConfig({ allow_commands: true }) });
  const refused = await readOnly.fake.sceneAction('enable_guest_wifi', {});
  assert.equal(refused.success, false);
  assert.match(refused.error, /read-only/);
  assert.equal(device.data['show/interface']['WifiMaster0/AccessPoint1'].state, 'down');
});

test('a command the router accepts without effect is an error', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  // This KeeneticOS ignores the command (an empty answer, no error).
  w.router.execute = function execute(command, user) {
    return 'interface' in command
      ? { interface: {} }
      : FakeKeenetic.prototype.execute.call(this, command, user);
  };
  const ack = await w.fake.sceneAction('enable_guest_wifi', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /unexpected answer/);
});

test('Internet access of a device: blocked and allowed, registered devices only', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  await createAll(w);
  const device = (mac) => ids(w.gladys).client(mac).device;
  let ack = await w.fake.sceneAction('block_device_internet', { device: device(CAMILLE) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { blocked: true });
  assert.equal(w.router.host(CAMILLE).access, 'deny');
  assert.ok(w.router.saves >= 1);
  ack = await w.fake.sceneAction('allow_device_internet', { device: device(TABLET) });
  assert.deepEqual(ack.data.outputs, { blocked: false });
  assert.equal(w.router.host(TABLET).access, 'permit');

  ack = await w.fake.sceneAction('block_device_internet', { device: device(ESP) });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Register this device/);
  ack = await w.fake.sceneAction('block_device_internet', {
    device: ids(w.gladys).router().device,
  });
  assert.match(ack.error, /Choose a network device/);
  ack = await w.fake.sceneAction('block_device_internet', { device: device('00:00:5e:00:53:77') });
  assert.match(ack.error, /does not know this device/);
});

test('reboot: asked once, the session is dropped; a router hanging up counts as rebooting', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  const ack = await w.fake.sceneAction('reboot_router', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.router.reboots, 1);
  assert.equal(w.hub.client, null);

  const hangUp = await world(t, { config: baseConfig({ allow_commands: true }) });
  const original = hangUp.network.request;
  hangUp.hub.client.session.request = async (url, options) => {
    if (url.endsWith('/rci/system/reboot')) {
      const err = new Error('socket hang up');
      err.code = 'ECONNRESET';
      throw err;
    }
    return original(url, options);
  };
  const hung = await hangUp.fake.sceneAction('reboot_router', {});
  assert.equal(hung.success, true, hung.error);
});

test('reconfiguration: a new address starts over, a new delay does not', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createAll(w);
  const logins = w.router.logins.ok;
  await w.fake.configUpdated(baseConfig({ away_delay: 10 }));
  assert.equal(w.router.logins.ok, logins, 'the session is kept');
  assert.equal(w.hub.presence.awayDelayMs, 600_000);
  await w.fake.configUpdated(baseConfig({ host: '192.0.2.9' }));
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
});

test('no address, no user: a clear message, nothing read', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /adresse/);
  assert.equal(w.router.calls.length, 0);
  const noUser = await world(t, { config: { host: '192.0.2.1' } });
  assert.match(noUser.fake.connectionStatus.message.en, /user name/);
  const https = await world(t, { config: baseConfig({ host: 'https://192.0.2.1' }) });
  assert.match(https.fake.connectionStatus.message.en, /without https/);
});
