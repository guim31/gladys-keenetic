// -----------------------------------------------------------------------------
// The probe script (scripts/probe.mjs) against the fake Keenetic: it reads
// only, and its report carries no address, MAC, name, SSID, cookie nor
// password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe.mjs';
import { FakeKeenetic, createNetwork } from './helpers/fakeKeenetic.js';

const run = (device, extra) => {
  const network = createNetwork({ '192.0.2.1': device });
  return probe({ host: '192.0.2.1', request: network.request, ...extra });
};

test('without credentials: the real login runs until the router refuses an invented account', async () => {
  const device = new FakeKeenetic();
  const text = (await run(device, {})).join('\n');
  assert.match(text, /Login: auth — POST \/auth: HTTP 401/);
  assert.match(text, /Challenge offered: yes/);
  assert.equal(device.logins.ok, 0);
  assert.equal(device.logins.failed, 1);
});

test('nothing answering, or not a Keenetic', async () => {
  const nobody = createNetwork({});
  const text = (await probe({ host: '192.0.2.1', request: nobody.request })).join('\n');
  assert.match(text, /Login: unreachable/);
});

test('with credentials: reads only, and nothing private in the report', async () => {
  for (const fixture of ['giga-4.1-pppoe-lte', 'ultra-5.1-wireguard']) {
    const device = new FakeKeenetic({ fixture });
    const lines = await run(device, { username: 'gladys', password: 'secret' });
    const text = lines.join('\n');
    assert.match(text, /Login: ok/);
    assert.match(text, /show ip hotspot: ok/);
    assert.match(text, /show interface stat: ok; fields: rxbytes, rxpackets, txbytes, txpackets/);
    assert.ok(
      device.calls.every((call) => !call.user),
      'no command, only readings',
    );
    assert.equal(device.saves, 0);
    for (const secret of [
      'secret',
      '192.0.2',
      '198.51.100',
      '203.0.113',
      '00:00:5e',
      'Camille',
      'Maison',
      'Home-Network',
      'Fibre',
      'Keenetic-0042',
      ...device.cookies.keys(),
    ]) {
      assert.ok(!text.includes(secret), `"${secret}" in the report (${fixture})`);
    }
    if (fixture.startsWith('giga')) {
      assert.match(text, /Internet connections kept: PPPoE, UsbLte \(mobile\)/);
      assert.match(text, /Model Giga \(KN-1011\) \(KN-1011\), KeeneticOS 4\.1\.7/);
    } else {
      assert.match(
        text,
        /through a Wireguard interface \(not an Internet connection: a tunnel\?\)/,
      );
    }
  }
});

test('a wrong password with credentials: the kind of the refusal', async () => {
  const text = (await run(new FakeKeenetic(), { username: 'gladys', password: 'wrong' })).join(
    '\n',
  );
  assert.match(text, /No session: auth/);
  assert.ok(!text.includes('wrong'));
});
