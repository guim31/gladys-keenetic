// -----------------------------------------------------------------------------
// The dashboard widgets (src/widgets.js): every content passes the SDK
// validator (vocabulary and budget of the core) in every language and state,
// the buttons exist only when the commands are allowed, and their actions do
// what they say. (Adapted from guim31/gladys-openwrt.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGETS, shortDuration } from '../src/widgets.js';
import {
  FakeKeenetic,
  baseConfig,
  createAll,
  createWorld,
  fullUser,
  later,
} from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, key, { settings = {}, language = 'en' } = {}) {
  const ack = await w.fake.widgetGet(key, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const result = ack.data.content;
  assert.deepEqual(validateWidgetContent(result), [], `${key} (${language}) is valid`);
  return result;
}

const types = (result) => result.components.map((component) => component.type);

test('router: health tiles, Internet, backup, guest Wi-Fi, uptime, version; no button by default', async (t) => {
  const w = await world(t);
  w.router.traffic('PPPoE0', 75_000_000, 7_500_000);
  await later(w, 1);
  for (const language of LANGS) {
    const result = await content(w, 'router', { language });
    assert.deepEqual(types(result), ['value', 'value', 'value', 'value', 'value', 'status']);
    assert.equal(result.ttl_seconds, 30);
  }
  const result = await content(w, 'router');
  assert.deepEqual(
    result.components.slice(0, 5).map((c) => c.value),
    [7, 23, '10.0', '1.0', 4],
  );
  assert.deepEqual(
    result.components[5].items.map((item) => [item.label, item.value]),
    [
      ['Internet', 'Available · Fibre'],
      ['Backup connection · 4G backup', 'Ready'],
      ['Guest Wi-Fi · Maison-Invites', 'Disabled'],
      ['Uptime', '4 d'],
      ['KeeneticOS', '4.1.7'],
    ],
  );
});

test('router: on the backup connection, then without Internet', async (t) => {
  const w = await world(t);
  w.router.setConnected('PPPoE0', false);
  w.router.setInternet(true, 'UsbLte0');
  await later(w, 1);
  let rows = (await content(w, 'router')).components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.slice(0, 2).map((item) => [item.value, item.color]),
    [
      ['Available · 4G backup', 'success'],
      ['In use', 'warning'],
    ],
  );
  w.router.setConnected('UsbLte0', false);
  w.router.setInternet(false, null);
  await later(w, 1);
  rows = (await content(w, 'router')).components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.slice(0, 2).map((item) => [item.value, item.color]),
    [
      ['Unavailable', 'danger'],
      ['Down', 'neutral'],
    ],
  );
});

test('router: the guest Wi-Fi and reboot buttons ask for a confirmation and act', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  const result = await content(w, 'router');
  const buttons = result.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.icon, b.style, b.action]),
    [
      [
        'Guest Wi-Fi',
        'circle',
        'secondary',
        { key: 'guest_wifi', params: { enabled: true }, confirm: true },
      ],
      ['Reboot', 'refresh-cw', 'danger', { key: 'reboot', confirm: true }],
    ],
  );
  const ack = await w.fake.widgetAction('router', 'guest_wifi', { enabled: true });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Wi-Fi invité activé.');
  const after = (await content(w, 'router')).components.filter((c) => c.type === 'button');
  assert.equal(after[0].icon, 'check-circle', 'the state is the icon, never the style');
  assert.deepEqual(after[0].action.params, { enabled: false });

  const reboot = await w.fake.widgetAction('router', 'reboot', {});
  assert.equal(reboot.success, true, reboot.error);
  assert.equal(w.router.reboots, 1);
  for (const language of LANGS) {
    assert.ok(reboot.data.message[language].length <= 200);
  }
  const unknown = await w.fake.widgetAction('router', 'nope', {});
  assert.equal(unknown.success, false);
});

test('router: no guest button when the router has no guest segment', async (t) => {
  const device = new FakeKeenetic({ users: fullUser() });
  delete device.data['show/interface'].Bridge1;
  const w = await world(t, { device, config: baseConfig({ allow_commands: true }) });
  const buttons = (await content(w, 'router')).components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    ['reboot'],
  );
});

test('router: waiting, no address, unreachable', async (t) => {
  const waiting = await WIDGETS.router.get(
    { config: { host: '192.0.2.1', username: 'gladys' }, router: null, snapshot: {} },
    { language: 'en' },
  );
  assert.deepEqual(validateWidgetContent(waiting), []);
  assert.match(waiting.components[0].text, /Waiting/);
  const none = await world(t, { config: { language: 'en' } });
  for (const key of ['router', 'presence']) {
    assert.match((await content(none, key)).components[0].text, /address/);
  }
  const w = await world(t);
  w.router.goOffline();
  await later(w, 1);
  for (const language of LANGS) {
    const result = await content(w, 'router', { language });
    assert.deepEqual(types(result), ['text', 'status']);
  }
  assert.equal((await content(w, 'router')).components[1].items[0].value, 'Unreachable');
});

test('presence: present first, away with the time since, blocked, the filter', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.router.disconnectHost('00:00:5e:00:53:20');
  await later(w, 10);
  for (const language of LANGS) {
    await content(w, 'presence', { language });
  }
  const result = await content(w, 'presence');
  assert.deepEqual(types(result), ['value', 'status']);
  assert.equal(result.components[0].value, 3);
  assert.equal(result.components[0].unit, '/ 5');
  assert.deepEqual(
    result.components[1].items.map((item) => [item.label, item.value]),
    [
      ['ESP-1A2B3C', 'Present'],
      ['NAS', 'Present'],
      ['Tablette des enfants', 'Present · blocked'],
      ['Camille', 'Away · 10 min'],
      ['Dominique', 'Away'],
    ],
  );
  const present = await content(w, 'presence', { settings: { show: 'present' } });
  assert.equal(present.components[1].items.length, 3);
});

test('presence: nobody followed, then the router unreachable is said', async (t) => {
  const w = await world(t);
  assert.match((await content(w, 'presence')).components[0].text, /Discovery tab/);
  await createAll(w);
  w.router.goOffline();
  await later(w, 1);
  const result = await content(w, 'presence');
  assert.deepEqual(types(result), ['value', 'text', 'status']);
  assert.match(result.components[1].text, /Unreachable/);
  const widget = await w.fake.widgetAction('presence', 'nope', {});
  assert.equal(widget.success, false);
});

test('short durations', () => {
  assert.equal(shortDuration(59, 'en'), '0 min');
  assert.equal(shortDuration(3 * 3600, 'fr'), '3 h');
  assert.equal(shortDuration(3 * 86400 + 4 * 3600, 'fr'), '3 j 4 h');
  assert.equal(shortDuration(2 * 86400, 'de'), '2 T');
});
