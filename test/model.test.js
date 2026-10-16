// -----------------------------------------------------------------------------
// The readers of the RCI answers (src/keenetic/model.js), on the fixtures: a
// Keenetic Ultra on KeeneticOS 5.1 with a WireGuard tunnel used for Internet
// (real answers, anonymized), and a Keenetic Giga on KeeneticOS 4.1 with a
// PPPoE fibre and a 4G backup (reconstructed).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostAccess,
  interfaceLabel,
  networkKind,
  normalizeMac,
  parseHosts,
  parseInterfaces,
  parseInternet,
  parseSegments,
  parseStations,
  parseSystem,
  parseVersion,
  wanConnections,
} from '../src/keenetic/model.js';
import { fixture } from './helpers/fakeKeenetic.js';

const ultra = fixture('ultra-5.1-wireguard');
const giga = fixture('giga-4.1-pppoe-lte');

test('MAC addresses are lowercase with colons', () => {
  assert.equal(normalizeMac('00-00-5E-00-53-AB'), '00:00:5e:00:53:ab');
  assert.equal(normalizeMac('00:00:00:00:00:00'), null);
  assert.equal(normalizeMac('nope'), null);
  assert.equal(normalizeMac(undefined), null);
});

test('show system: load, memory used (as the web interface), uptime', () => {
  assert.deepEqual(parseSystem(ultra['show/system']), {
    cpuLoad: 2,
    memoryUsage: 30,
    uptimeSeconds: 99961,
    hostname: 'Keenetic_Ultra',
  });
  // Without the "used/total" string: total - free - buffers - cache.
  const { memory: _memory, ...withoutString } = giga['show/system'];
  assert.equal(parseSystem(withoutString).memoryUsage, 23);
  assert.deepEqual(parseSystem(null), {
    cpuLoad: null,
    memoryUsage: null,
    uptimeSeconds: null,
    hostname: null,
  });
});

test('show version: the KeeneticOS version and the model', () => {
  assert.deepEqual(parseVersion(ultra['show/version']), {
    firmware: '5.1.3',
    release: '5.01.C.3.0-1',
    model: 'Ultra (KN-1811)',
    hwId: 'KN-1811',
    device: 'Ultra',
  });
});

test('the Internet connections skip the VPN tunnels and the port under a PPPoE', () => {
  const ultraWan = wanConnections(parseInterfaces(ultra['show/interface']));
  // Wireguard3 holds the default route and the highest priority: still a tunnel.
  assert.deepEqual(
    ultraWan.map((item) => item.id),
    ['GigabitEthernet1'],
  );
  const gigaWan = wanConnections(parseInterfaces(giga['show/interface']));
  assert.deepEqual(
    gigaWan.map((item) => item.id),
    ['PPPoE0', 'UsbLte0'],
  );
  assert.equal(gigaWan[1].mobile, true);
  assert.equal(interfaceLabel(gigaWan[1]), '4G backup');
  // A port under a PPPoE that is global itself is no connection of its own.
  const interfaces = parseInterfaces(giga['show/interface']).map((item) =>
    item.id === 'GigabitEthernet1' ? { ...item, global: true, priority: 60000 } : item,
  );
  assert.deepEqual(
    wanConnections(interfaces).map((item) => item.id),
    ['PPPoE0', 'UsbLte0'],
  );
});

test('the switch ports of `show interface` are not interfaces', () => {
  const ids = parseInterfaces(ultra['show/interface']).map((item) => item.id);
  assert.ok(!ids.some((id) => /^\d$/.test(id) || id.includes('GigabitEthernet1/0')));
  assert.ok(ids.includes('WifiMaster0/AccessPoint1'));
});

test('the segments and their access points: home is private, guest is protected', () => {
  const segments = parseSegments(parseInterfaces(giga['show/interface']));
  assert.deepEqual(
    segments.map((item) => [item.id, networkKind(item.securityLevel), item.accessPoints.length]),
    [
      ['Bridge0', 'home', 2],
      ['Bridge1', 'guest', 2],
    ],
  );
  const guest = segments[1];
  assert.deepEqual(
    guest.accessPoints.map((ap) => [ap.id, ap.enabled]),
    [
      ['WifiMaster0/AccessPoint1', false],
      ['WifiMaster1/AccessPoint1', false],
    ],
  );
  const ultraGuest = parseSegments(parseInterfaces(ultra['show/interface'])).find(
    (item) => item.id === 'Bridge1',
  );
  assert.ok(ultraGuest.accessPoints.every((ap) => ap.enabled));
  assert.equal(ultraGuest.accessPoints[0].ssid, 'Home-Guests');
});

test('show ip hotspot: hosts, active or not, registered or not, blocked or not', () => {
  const hosts = parseHosts(giga['show/ip/hotspot']);
  assert.equal(hosts.length, 5);
  const byMac = new Map(hosts.map((host) => [host.mac, host]));
  assert.deepEqual(byMac.get('00:00:5e:00:53:21'), {
    mac: '00:00:5e:00:53:21',
    ip: '192.0.2.21',
    hostName: 'NAS',
    registered: true,
    denied: false,
    active: true,
    wifi: false,
    ssid: null,
    segment: 'Bridge0',
  });
  assert.equal(byMac.get('00:00:5e:00:53:22').denied, true);
  assert.equal(byMac.get('00:00:5e:00:53:23').active, false);
  // No name given in the router: the DHCP host name.
  assert.equal(byMac.get('00:00:5e:00:53:24').hostName, 'ESP-1A2B3C');
  // An inactive host with 0.0.0.0 has no address.
  const ultraHosts = parseHosts(ultra['show/ip/hotspot']);
  assert.equal(ultraHosts.find((host) => host.mac === '00:00:5e:00:53:1c').ip, null);
});

test('show associations and show internet status', () => {
  const stations = parseStations(giga['show/associations']);
  assert.equal(stations.length, 4);
  assert.equal(stations.filter((station) => station.authenticated).length, 3);
  assert.deepEqual(parseInternet(ultra['show/internet/status']), {
    internet: true,
    gateway: 'Wireguard3',
  });
  assert.deepEqual(parseInternet({}), { internet: null, gateway: null });
});

test('the access rule of a host, from the configuration branch', () => {
  assert.equal(hostAccess(giga['ip/hotspot/host'], '00:00:5e:00:53:22'), 'deny');
  assert.equal(hostAccess(giga['ip/hotspot/host'], '00:00:5e:00:53:20'), 'permit');
  assert.equal(hostAccess(giga['ip/hotspot/host'], '00:00:5e:00:53:99'), null);
});
