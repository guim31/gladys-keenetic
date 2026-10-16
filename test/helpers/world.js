// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Keenetic on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the router with
// `world.hub.pollAll()`. (Adapted from guim31/gladys-openwrt.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeKeenetic, createNetwork } from './fakeKeenetic.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOST = '192.0.2.1';
export const PASSWORD = 'secret-Keenetic-pw';

/** A manual clock, shared by the hub, the fake router and the tests. */
export function createClock(start = Date.UTC(2026, 9, 15, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const fullUser = (password = PASSWORD) => ({ gladys: { password } });
export const readOnlyUser = (password = PASSWORD) => ({ gladys: { password, readonly: true } });

export const baseConfig = (extra = {}) => ({
  host: HOST,
  username: 'gladys',
  password: PASSWORD,
  language: 'en',
  ...extra,
});

/**
 * @param {object} [options]
 * @param {FakeKeenetic} [options.device] the router at HOST
 * @param {object} [options.deviceOptions] options of the default router
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  device,
  deviceOptions = {},
  config = baseConfig(),
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-keenetic-')),
  timings = {},
  timers = false,
} = {}) {
  const router =
    device ?? new FakeKeenetic({ users: fullUser(), now: clock.now, ...deviceOptions });
  const network = createNetwork({ [HOST]: router });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    seams: { request: network.request },
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    router,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

/** Add discovered devices in Gladys, as the user would (all of them by default). */
export async function createAll(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** The external ids the integration builds (the router of the default fixture). */
export const ids = (gladys) => ({
  router: (id = '00-00-5e-00-53-01') => gladys.externalIds('router', id),
  client: (mac) => gladys.externalIds('client', mac.toLowerCase()),
});

/** One reading `minutes` later. */
export async function later(world, minutes = 1) {
  world.clock.advance(minutes * 60_000);
  await world.hub.pollAll();
}

export { FakeKeenetic, createNetwork };
