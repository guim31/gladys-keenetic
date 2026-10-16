// -----------------------------------------------------------------------------
// The Keenetic hub: one RCI session on the router, read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, its scene events fired on transitions, and the
// commands (guest Wi-Fi, reboot, Internet access of a device) of the scene
// actions and the widgets.
//
// Gladys never polls these devices (should_poll: false): Gladys 5.2 does not
// reliably poll external devices (GladysAssistant/Gladys#3198), and the scene
// events must fire even for a router whose device was not added.
// (Adapted from guim31/gladys-openwrt.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  DEVICE_TYPES,
  FEATURE_KEYS,
  buildClientDevice,
  buildRouterDevice,
  clientIds,
  names,
  paramOf,
  parseDeviceId,
  routerIds,
  routerName,
  slugify,
} from './devices.js';
import { PresenceTracker, SOURCES, collectClients } from './presence.js';
import { openClient } from './keenetic/client.js';
import { ERROR_KINDS, KeeneticError } from './keenetic/errors.js';
import {
  interfaceLabel,
  networkKind,
  normalizeMac,
  parseSegments,
  wanConnections,
} from './keenetic/model.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, pick } from './texts.js';

const logger = createLogger({ name: 'keenetic-hub' });

export const WIDGET_KEYS = Object.freeze({
  ROUTER: 'router',
  PRESENCE: 'presence',
});

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UNKNOWN_DEVICE: 'unknown_device_connected',
  INTERNET_DOWN: 'internet_down',
  INTERNET_UP: 'internet_up',
  BACKUP_ACTIVE: 'backup_connection_active',
  PRIMARY_RESTORED: 'primary_connection_restored',
});

export const HUB_TIMINGS = {
  // The discovery list follows the devices seen, at most this often.
  discoveryMs: 5 * 60_000,
  // A refused password is tried again this late, not at every reading: each
  // try is a failed login in the router log.
  authRetryMs: 5 * 60_000,
  // A present device is published again this often: the "Check presence"
  // scene action of Gladys reads the date of the last value received.
  presentRefreshMs: 2 * 60_000,
  // Any other unchanged value is published again this often, so Gladys never
  // shows it as "no recent value".
  heartbeatMs: 6 * 60 * 60_000,
  // A device seen this long ago leaves the discovery list.
  clientMemoryMs: 7 * 24 * 60 * 60_000,
  // A reboot answers before restarting, or hangs up: never wait long.
  commandTimeoutMs: 15_000,
};

const MAX_STATES_PER_REQUEST = 100;
const MAX_DISCOVERED_CLIENTS = 250;
const MAX_KNOWN_MACS = 5000;
// "Unknown device connected" events per reading at most: a reset of the
// router or a new guest network never floods the scenes.
const MAX_UNKNOWN_EVENTS = 5;

const sessionSignature = (config) =>
  JSON.stringify([config.host, config.port, config.username, config.password]);

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export class KeeneticHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} [options.seams] { request, timeoutMs } network seams (tests)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, seams = {}, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.seams = seams;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    this.router = null;
    this.resetReading();
    this.saved = { knownMacs: {}, baselined: false };
    /** Last value published per feature external id: { key, at }. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discoveryKey = null;
    this.discoveryAt = 0;
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  /** Forget what was read from the router (a new router, new credentials). */
  resetReading() {
    this.snapshot = {
      reachable: null,
      error: null,
      system: null,
      wan: null,
      guest: null,
      segments: [],
      counts: { hosts: null, wifi: null },
      gaps: [],
    };
    this.counters = null;
    this.wanIds = [];
    this.internetDownSince = null;
    this.backupSince = null;
    this.onBackup = null;
    this.clients = new Map();
    this.lastClients = new Map();
    this.retryAfter = 0;
    this.presence = new PresenceTracker({
      awayDelayMs: this.config?.awayDelayMs ?? 0,
      now: () => this.now(),
    });
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (router connected, lost, back, user
  // commands). A problem that repeats every reading is logged once at its own
  // level, then at debug until it clears. LOG_LEVEL=debug shows everything.
  // Never a password, its hash nor the session cookie.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      knownMacs:
        saved.knownMacs && typeof saved.knownMacs === 'object' && !Array.isArray(saved.knownMacs)
          ? saved.knownMacs
          : {},
      baselined: saved.baselined === true,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transports.clear();
    this.connection = null;
    this.discoveryKey = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = sessionSignature(config);
    if (signature !== this.signature) {
      this.signature = signature;
      await this.polling?.catch(() => {});
      await this.closeSession();
      if (previous?.host !== config.host) {
        this.router = null;
      }
      this.resetReading();
      this.warned.clear();
    }
    this.presence.awayDelayMs = config.awayDelayMs;
    // The guest segment or the names may have changed.
    this.discoveryKey = null;
    await this.pollAll();
    this.schedulePoll();
  }

  async closeSession() {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close().catch(() => {});
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.polling?.catch(() => {});
    await this.closeSession();
    await this.store.flush();
  }

  ready() {
    return Boolean(this.config?.host && this.config.username);
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.ready()) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', `Reading failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading the router ------------------------------------------------------

  /** One reading; concurrent calls share it. */
  pollAll() {
    this.polling ??= this.poll().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** Gladys asks for a refresh (onPoll): a reading covers every device. */
  async pollDevice() {
    if (!this.timersEnabled || !this.pollTimer) {
      await this.pollAll();
    }
  }

  async poll() {
    if (!this.ready()) {
      await this.publishConnectionStatus();
      return;
    }
    if (this.now() < this.retryAfter) {
      return;
    }
    let reading;
    try {
      if (!this.client) {
        await this.connect();
      }
      reading = await this.client.read({ counters: this.wanIds });
      reading.at = this.now();
    } catch (err) {
      if (!(err instanceof KeeneticError)) {
        throw err;
      }
      await this.applyFailure(err);
      return;
    }
    await this.applyReading(reading);
  }

  async connect() {
    const client = await openClient({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      request: this.seams.request,
      timeoutMs: this.seams.timeoutMs,
    });
    this.client = client;
    try {
      await this.readIdentity();
    } catch (err) {
      await this.closeSession();
      throw err;
    }
  }

  /** What identifies the router, read once per session. */
  async readIdentity() {
    const identity = await this.client.identity();
    const routerId = identity.mac ? slugify(identity.mac) : `host-${slugify(this.config.host)}`;
    const same = this.router?.id === routerId;
    if (this.router && !same) {
      // Another router at the same address: start over.
      this.resetReading();
    }
    // The counters of the Internet connections are read from the first reading on.
    this.wanIds = wanConnections(identity.interfaces).map((item) => item.id);
    if (identity.identificationError) {
      logger.debug(`show identification: ${identity.identificationError.message}`);
    }
    this.router = {
      id: routerId,
      host: this.config.host,
      model: identity.model,
      device: identity.device,
      firmware: identity.firmware,
      hostname: same ? this.router.hostname : null,
      hasFirmware: Boolean(identity.firmware) || (same && this.router.hasFirmware),
      backup: same ? this.router.backup : false,
      guest: same ? this.router.guest : false,
      hasHosts: same ? this.router.hasHosts : false,
      hasStations: same ? this.router.hasStations : false,
    };
  }

  label() {
    return this.router ? `Router ${routerName(this.router)}` : `Router ${this.config.host}`;
  }

  async applyFailure(err) {
    const wasError = this.snapshot.error?.kind;
    const wasReachable = this.snapshot.reachable;
    this.snapshot.error = { kind: err.kind, message: err.message };
    this.snapshot.reachable = false;
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label()}: ${err.message}`);
    } else {
      logger.debug(`${this.label()}: ${err.message} (again)`);
    }
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.PERMISSION) {
      this.retryAfter = this.now() + this.timings.authRetryMs;
    }
    // A new session next time (the router may have restarted).
    await this.closeSession();
    // The rates restart from the next two readings.
    this.counters = null;
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (wasReachable !== false) {
      this.refreshWidgets();
    }
  }

  async applyReading(reading) {
    const now = reading.at;
    if (this.snapshot.error || this.snapshot.reachable !== true) {
      if (this.snapshot.error) {
        logger.info(`${this.label()}: connection restored`);
      } else {
        logger.info(
          `${this.label()}: connected (KeeneticOS ${this.router.firmware ?? '?'}, user ${this.config.username})`,
        );
      }
    }
    this.snapshot.error = null;
    this.snapshot.reachable = true;
    this.retryAfter = 0;

    // Gaps: what this KeeneticOS or this user does not offer. A refusal is
    // worth one warning.
    for (const gap of reading.gaps) {
      const message = `${this.label()}: ${gap.what} not readable (${gap.kind})`;
      if (gap.kind === ERROR_KINDS.PERMISSION) {
        this.problem(`gap:${gap.what}`, message);
      } else {
        logger.debug(message);
      }
    }
    this.snapshot.gaps = reading.gaps;

    // The structure of the router device: a feature seen once stays.
    this.router.hostname = reading.system.hostname ?? this.router.hostname;
    if (reading.hosts) {
      this.router.hasHosts = true;
    }
    if (reading.stations) {
      this.router.hasStations = true;
    }
    this.snapshot.system = reading.system;

    const widgetsChanged = new Set();
    await this.applyWan(reading, widgetsChanged);
    this.applyGuest(reading, widgetsChanged);

    const clients = collectClients(reading);
    this.lastClients = clients;
    for (const client of clients.values()) {
      const known = this.clients.get(client.mac);
      this.clients.set(client.mac, {
        ...known,
        ...Object.fromEntries(Object.entries(client).filter(([, value]) => value !== null)),
        lastSeenAt: client.seen ? now : (known?.lastSeenAt ?? null),
        listedAt: now,
      });
    }
    for (const [mac, client] of this.clients) {
      if (now - (client.listedAt ?? 0) > this.timings.clientMemoryMs) {
        this.clients.delete(mac);
      }
    }
    this.snapshot.counts = {
      hosts: reading.hosts ? reading.hosts.filter((host) => host.active).length : null,
      wifi: reading.stations
        ? new Set(reading.stations.filter((s) => s.authenticated).map((s) => s.mac)).size
        : null,
    };
    if (this.presence.update(this.followedClients(), clients).length > 0) {
      widgetsChanged.add(WIDGET_KEYS.PRESENCE);
    }

    await this.detectUnknownDevices(clients, now);
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    for (const key of widgetsChanged) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  /** Internet, the connection in use, its rates, the backup connection. */
  async applyWan(reading, widgetsChanged) {
    const now = reading.at;
    const connections = wanConnections(reading.interfaces);
    this.wanIds = connections.map((item) => item.id);
    if (connections.length >= 2) {
      this.router.backup = true;
    }
    const [primary] = connections;
    const gateway = reading.internet?.gateway ?? null;
    const carrying =
      connections.find((item) => item.id === gateway) ??
      connections.find((item) => item.connected) ??
      null;
    // Without `show internet status` (a user without the right), the
    // established connection says it.
    const internet = reading.internet?.internet ?? (carrying ? carrying.connected : null);
    const active = internet ? carrying : null;
    const backups = connections.slice(1);
    const backup = backups.find((item) => item.connected) ?? backups[0] ?? null;

    // Rates: the byte counters of the connection in use, else of the
    // preferred one, between two readings on the same interface.
    const measured = active ?? primary ?? null;
    const stat = measured ? reading.stats.get(measured.id) : null;
    let download = null;
    let upload = null;
    const previous = this.counters;
    if (previous && now - previous.at < 1000) {
      // A reading right after another (a connection test): the rates of the
      // previous interval stand, the counters keep their reference.
      download = this.snapshot.wan?.download ?? null;
      upload = this.snapshot.wan?.upload ?? null;
    } else {
      if (
        stat &&
        previous &&
        previous.id === measured.id &&
        stat.rxBytes !== null &&
        stat.txBytes !== null
      ) {
        const seconds = (now - previous.at) / 1000;
        const rx = stat.rxBytes - previous.rx;
        const tx = stat.txBytes - previous.tx;
        // A counter that went back (reboot, new PPPoE session) gives no rate this time.
        download = rx >= 0 ? round((rx * 8) / seconds / 1e6, 2) : null;
        upload = tx >= 0 ? round((tx * 8) / seconds / 1e6, 2) : null;
      }
      this.counters =
        stat && stat.rxBytes !== null && stat.txBytes !== null
          ? { id: measured.id, rx: stat.rxBytes, tx: stat.txBytes, at: now }
          : null;
    }

    const before = this.snapshot.wan;
    const backupActive = Boolean(internet && active && primary && active.id !== primary.id);
    this.snapshot.wan = {
      internet,
      active: active
        ? { id: active.id, label: interfaceLabel(active), mobile: active.mobile }
        : null,
      primary: primary ? { id: primary.id, label: interfaceLabel(primary) } : null,
      backup: backup
        ? { id: backup.id, label: interfaceLabel(backup), connected: backup.connected }
        : null,
      backupActive,
      connections: connections.map((item) => ({
        id: item.id,
        label: interfaceLabel(item),
        connected: item.connected,
      })),
      download,
      upload,
    };
    // On the backup connection or not: only known while Internet is up (an
    // outage on the backup that ends on the main connection is a return).
    const wasOnBackup = this.onBackup;
    if (internet) {
      this.onBackup = backupActive;
    }
    if (!before) {
      if (internet === false) {
        this.internetDownSince = now;
      }
      if (this.onBackup) {
        this.backupSince = now;
      }
      return;
    }

    // Transitions: one event each, never on the first reading.
    const lastLabel = before.active?.label ?? before.primary?.label ?? null;
    if (before.internet === true && internet === false) {
      this.internetDownSince = now;
      logger.info(`${this.label()}: Internet is down`);
      widgetsChanged.add(WIDGET_KEYS.ROUTER);
      await this.fire(TRIGGERS.INTERNET_DOWN, { connection: lastLabel });
    } else if (before.internet === false && internet === true) {
      const since = this.internetDownSince ?? now;
      this.internetDownSince = null;
      const downMinutes = Math.round((now - since) / 60_000);
      logger.info(`${this.label()}: Internet is back after ${downMinutes} min`);
      widgetsChanged.add(WIDGET_KEYS.ROUTER);
      await this.fire(TRIGGERS.INTERNET_UP, {
        connection: this.snapshot.wan.active?.label ?? null,
        down_minutes: downMinutes,
      });
    }
    if (wasOnBackup === false && this.onBackup === true) {
      this.backupSince = now;
      logger.info(`${this.label()}: Internet through the backup connection`);
      widgetsChanged.add(WIDGET_KEYS.ROUTER);
      await this.fire(TRIGGERS.BACKUP_ACTIVE, {
        connection: this.snapshot.wan.active.label,
        primary: this.snapshot.wan.primary.label,
      });
    } else if (wasOnBackup === true && this.onBackup === false) {
      const since = this.backupSince ?? now;
      this.backupSince = null;
      const backupMinutes = Math.round((now - since) / 60_000);
      logger.info(
        `${this.label()}: Internet through the main connection again after ${backupMinutes} min`,
      );
      widgetsChanged.add(WIDGET_KEYS.ROUTER);
      await this.fire(TRIGGERS.PRIMARY_RESTORED, {
        connection: this.snapshot.wan.primary.label,
        backup_minutes: backupMinutes,
      });
    }
    if (before.active?.id !== this.snapshot.wan.active?.id) {
      widgetsChanged.add(WIDGET_KEYS.ROUTER);
    }
  }

  /** The guest segment: the one of the configuration, else the "protected" one with Wi-Fi. */
  guestSegment(segments) {
    if (this.config.guestSegment) {
      const segment = segments.find((item) => item.id === this.config.guestSegment);
      return segment?.accessPoints.length ? segment : null;
    }
    return (
      segments.find((item) => item.securityLevel === 'protected' && item.accessPoints.length) ??
      null
    );
  }

  applyGuest(reading, widgetsChanged) {
    const segments = parseSegments(reading.interfaces);
    this.snapshot.segments = segments;
    const segment = this.guestSegment(segments);
    const before = this.snapshot.guest?.enabled;
    this.snapshot.guest = segment
      ? {
          id: segment.id,
          label: segment.label,
          ssid: segment.accessPoints.find((ap) => ap.ssid)?.ssid ?? null,
          accessPoints: segment.accessPoints.map((ap) => ap.id),
          enabled: segment.accessPoints.some((ap) => ap.enabled),
        }
      : null;
    if (segment) {
      this.router.guest = true;
    }
    if (this.snapshot.guest?.enabled !== before) {
      widgetsChanged.add(WIDGET_KEYS.ROUTER);
    }
  }

  /** Fire "unknown device connected" for a MAC address never seen before. */
  async detectUnknownDevices(clients, now) {
    const known = this.saved.knownMacs;
    const kinds = new Map(this.snapshot.segments.map((item) => [item.id, item.securityLevel]));
    let changed = false;
    let fired = 0;
    let seen = 0;
    for (const client of clients.values()) {
      if (!client.seen) {
        continue;
      }
      seen += 1;
      if (client.mac in known) {
        continue;
      }
      known[client.mac] = now;
      changed = true;
      if (!this.saved.baselined) {
        continue; // the first reading learns the network as it is
      }
      const connection = client.wifi ? SOURCES.WIFI : SOURCES.WIRED;
      logger.info(`${this.label()}: new device on the network (${connection})`);
      if (fired < MAX_UNKNOWN_EVENTS) {
        fired += 1;
        await this.fire(TRIGGERS.UNKNOWN_DEVICE, {
          mac: client.mac,
          ip: client.ip ?? null,
          host_name: client.hostName ?? null,
          network: networkKind(kinds.get(client.segment) ?? null),
          connection,
          ssid: client.ssid ?? null,
        });
      }
    }
    if (!this.saved.baselined && seen > 0) {
      this.saved.baselined = true;
      changed = true;
    }
    const macs = Object.keys(known);
    if (macs.length > MAX_KNOWN_MACS) {
      // The oldest first.
      macs
        .sort((a, b) => known[a] - known[b])
        .slice(0, macs.length - MAX_KNOWN_MACS)
        .forEach((mac) => delete known[mac]);
    }
    if (changed) {
      this.store.save(this.saved);
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Devices -------------------------------------------------------------------

  /** The devices the user added to Gladys, by type. */
  createdDevices(type) {
    return (this.gladys.devices ?? []).filter(
      (device) => parseDeviceId(this.gladys, device.external_id)?.type === type,
    );
  }

  /** MAC addresses of the network devices added to Gladys. */
  followedClients() {
    const macs = [];
    for (const device of this.createdDevices(DEVICE_TYPES.CLIENT)) {
      const mac =
        normalizeMac(paramOf(device, 'MAC_ADDRESS')) ??
        normalizeMac(parseDeviceId(this.gladys, device.external_id).id);
      if (mac) {
        macs.push(mac);
      }
    }
    return macs;
  }

  discoveredClients() {
    const followed = new Set(this.followedClients());
    const list = [...this.clients.values()];
    // The followed ones first (always listed), then the registered ones, then
    // the most recently seen.
    list.sort(
      (a, b) =>
        Number(followed.has(b.mac)) - Number(followed.has(a.mac)) ||
        Number(Boolean(b.registered)) - Number(Boolean(a.registered)) ||
        (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) ||
        a.mac.localeCompare(b.mac),
    );
    const result = list.slice(0, MAX_DISCOVERED_CLIENTS);
    for (const mac of followed) {
      if (!this.clients.has(mac)) {
        result.push({ mac, ip: null, hostName: null });
      }
    }
    return result;
  }

  async publishDevices({ force = false } = {}) {
    const language = this.config.language;
    const devices = [];
    if (this.router) {
      devices.push(buildRouterDevice(this.gladys, this.router, language));
    }
    const clients = this.discoveredClients();
    devices.push(...clients.map((client) => buildClientDevice(this.gladys, client, language)));

    // The router publishes at once; the device list at most every few minutes.
    const structure = JSON.stringify(devices.slice(0, devices.length - clients.length));
    const members = clients
      .map((client) => `${client.mac}=${client.hostName ?? ''}`)
      .sort()
      .join(',');
    const key = `${structure}|${members}`;
    if (!force && key === this.discoveryKey) {
      return;
    }
    const structureChanged = !this.discoveryKey?.startsWith(`${structure}|`);
    if (!force && !structureChanged && this.now() - this.discoveryAt < this.timings.discoveryMs) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveryKey = key;
      this.discoveryAt = this.now();
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the router, publish everything again. */
  async rediscover() {
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    for (const feature of device.features ?? []) {
      this.published.delete(feature.external_id);
    }
    const parsed = parseDeviceId(this.gladys, device.external_id);
    if (parsed?.type === DEVICE_TYPES.CLIENT && this.snapshot.reachable) {
      // Follow it at once, from the last reading.
      this.presence.update(this.followedClients(), this.lastClients);
    }
    await this.publishStates();
    if (parsed) {
      this.gladys.requestWidgetRefresh(
        parsed.type === DEVICE_TYPES.CLIENT ? WIDGET_KEYS.PRESENCE : WIDGET_KEYS.ROUTER,
      );
    }
  }

  // --- Publishing to Gladys ------------------------------------------------------------

  /** Every value to publish: { externalId, value, heartbeat }. */
  stateEntries() {
    const entries = [];
    const add = (externalId, value, heartbeat = this.timings.heartbeatMs) => {
      if (value === null || value === undefined) {
        return;
      }
      entries.push({ externalId, value, heartbeat });
    };
    if (this.router && this.snapshot.reachable) {
      const ids = routerIds(this.gladys, this.router.id);
      const { system, wan, guest, counts } = this.snapshot;
      add(ids.feature(FEATURE_KEYS.CPU), system?.cpuLoad);
      add(ids.feature(FEATURE_KEYS.MEMORY), system?.memoryUsage);
      if (system?.uptimeSeconds !== null && system?.uptimeSeconds !== undefined) {
        add(ids.feature(FEATURE_KEYS.UPTIME), Math.floor(system.uptimeSeconds / 3600));
      }
      if (this.router.firmware) {
        add(ids.feature(FEATURE_KEYS.FIRMWARE), { text: this.router.firmware });
      }
      if (wan) {
        if (wan.internet !== null) {
          add(ids.feature(FEATURE_KEYS.INTERNET), wan.internet ? 1 : 0);
        }
        add(ids.feature(FEATURE_KEYS.CONNECTION), {
          text: wan.active?.label ?? names(this.config.language).none,
        });
        add(ids.feature(FEATURE_KEYS.DOWNLOAD), wan.download);
        add(ids.feature(FEATURE_KEYS.UPLOAD), wan.upload);
        if (this.router.backup) {
          add(ids.feature(FEATURE_KEYS.BACKUP_ACTIVE), wan.backupActive ? 1 : 0);
          if (wan.backup) {
            add(ids.feature(FEATURE_KEYS.BACKUP_LINK), wan.backup.connected ? 1 : 0);
          }
        }
      }
      add(ids.feature(FEATURE_KEYS.WIFI_CLIENTS), counts.wifi);
      add(ids.feature(FEATURE_KEYS.CONNECTED), counts.hosts);
      if (this.router.guest && guest) {
        add(ids.feature(FEATURE_KEYS.GUEST), guest.enabled ? 1 : 0);
      }
    }
    for (const mac of this.followedClients()) {
      const present = this.presence.presence(mac);
      add(
        clientIds(this.gladys, mac).feature(FEATURE_KEYS.PRESENCE),
        present,
        present === 1 ? this.timings.presentRefreshMs : this.timings.heartbeatMs,
      );
    }
    return entries;
  }

  /** Publish the values that changed (or whose heartbeat is due), for the added devices only. */
  async publishStates() {
    const created = new Set(
      (this.gladys.devices ?? []).flatMap((device) =>
        (device.features ?? []).map((feature) => feature.external_id),
      ),
    );
    const now = this.now();
    const keyOf = (value) => (typeof value === 'object' ? `text:${value.text}` : value);
    const due = this.stateEntries().filter(({ externalId, value, heartbeat }) => {
      if (!created.has(externalId)) {
        return false; // Gladys would drop it, and count it in its quota
      }
      const last = this.published.get(externalId);
      return !last || last.key !== keyOf(value) || now - last.at >= heartbeat;
    });
    for (let at = 0; at < due.length; at += MAX_STATES_PER_REQUEST) {
      const batch = due.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(
          batch.map(({ externalId, value }) =>
            typeof value === 'object'
              ? { device_feature_external_id: externalId, text: value.text }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, { key: keyOf(value), at: now });
        }
        this.resolved('states');
      } catch (err) {
        this.problem('states', `States refused by Gladys: ${err.message}`);
      }
    }
  }

  async publishTransports() {
    if (this.snapshot.reachable === null || !this.router) {
      return;
    }
    const transport = this.snapshot.reachable
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
    const id = routerIds(this.gladys, this.router.id).device;
    if (this.transports.get(id) === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: id, transport }]);
      this.transports.set(id, transport);
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.host) {
      return {
        connected: false,
        message: this.config.invalidHost ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noHost,
      };
    }
    if (!this.config.username) {
      return { connected: false, message: CONNECTION_TEXT.noUser };
    }
    if (this.snapshot.error) {
      return { connected: false, message: ERROR_TEXT[this.snapshot.error.kind] };
    }
    if (this.snapshot.reachable) {
      return { connected: true };
    }
    return { connected: false, message: CONNECTION_TEXT.connecting };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidgets() {
    for (const key of Object.values(WIDGET_KEYS)) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  text(table) {
    return pick(table, this.config?.language);
  }

  assertCommands() {
    if (!this.config?.allowCommands) {
      throw new Error(this.text(ACTION_TEXT.disabled));
    }
  }

  /** The client for a command: the current session, or a new one. */
  async commandClient() {
    if (!this.ready()) {
      throw new Error(
        this.text(this.config.host ? CONNECTION_TEXT.noUser : CONNECTION_TEXT.noHost),
      );
    }
    if (!this.client) {
      this.retryAfter = 0;
      await this.pollAll();
    }
    if (!this.client) {
      const kind = this.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE;
      throw new Error(this.text(ERROR_TEXT[kind]));
    }
    return this.client;
  }

  commandError(err) {
    if (err instanceof KeeneticError && err.kind === ERROR_KINDS.PERMISSION) {
      return new Error(this.text(ACTION_TEXT.permission));
    }
    if (err instanceof KeeneticError) {
      return new Error(this.text(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.PROTOCOL]));
    }
    return err;
  }

  /**
   * Switch the Wi-Fi of the guest segment on or off (every access point of
   * the segment, 2.4 and 5 GHz).
   * @returns {Promise<{ enabled: boolean }>}
   */
  async setGuest(enabled) {
    this.assertCommands();
    const client = await this.commandClient();
    let segment;
    try {
      segment = this.guestSegment(parseSegments(await client.interfaces()));
    } catch (err) {
      throw this.commandError(err);
    }
    if (!segment) {
      throw new Error(
        this.text(this.config.guestSegment ? ACTION_TEXT.guestNotFound : ACTION_TEXT.noGuest),
      );
    }
    const ids = segment.accessPoints.map((ap) => ap.id);
    let after;
    try {
      after = await client.setAccessPoints(ids, enabled);
    } catch (err) {
      logger.warn(`Guest Wi-Fi ${segment.id}: command failed: ${err.message}`);
      throw this.commandError(err);
    }
    logger.info(`Guest Wi-Fi ${segment.id} ${enabled ? 'enabled' : 'disabled'}`);
    this.applyGuest({ interfaces: after }, new Set());
    await this.publishStates();
    this.gladys.requestWidgetRefresh(WIDGET_KEYS.ROUTER);
    return { enabled };
  }

  /** Restart the router. */
  async reboot() {
    this.assertCommands();
    const client = await this.commandClient();
    try {
      await client.reboot({ timeoutMs: this.timings.commandTimeoutMs });
    } catch (err) {
      // The router may hang up before answering: it is restarting.
      if (!(err instanceof KeeneticError && err.kind === ERROR_KINDS.UNREACHABLE)) {
        logger.warn(`Reboot refused: ${err.message}`);
        throw this.commandError(err);
      }
    }
    logger.info(`${this.label()}: reboot requested`);
    await this.closeSession();
    return { rebooting: true };
  }

  /**
   * Block or allow the Internet access of a network device followed by the
   * integration (the "Block access" of the web interface of the router).
   * @param {string} externalId the device chosen in the scene action
   * @returns {Promise<{ blocked: boolean }>}
   */
  async setBlocked(externalId, blocked) {
    this.assertCommands();
    const parsed = parseDeviceId(this.gladys, externalId);
    const mac = parsed?.type === DEVICE_TYPES.CLIENT ? normalizeMac(parsed.id) : null;
    if (!mac) {
      throw new Error(this.text(ACTION_TEXT.noDevice));
    }
    const client = await this.commandClient();
    const host = this.clients.get(mac);
    if (!host || host.registered === undefined) {
      throw new Error(this.text(ACTION_TEXT.unknownHost));
    }
    if (!host.registered) {
      throw new Error(this.text(ACTION_TEXT.notRegistered));
    }
    try {
      await client.setHostAccess(mac, blocked);
    } catch (err) {
      logger.warn(`Internet access of a device: command failed: ${err.message}`);
      throw this.commandError(err);
    }
    logger.info(`Internet access ${blocked ? 'blocked' : 'allowed'} for ${mac}`);
    host.denied = blocked;
    this.gladys.requestWidgetRefresh(WIDGET_KEYS.PRESENCE);
    return { blocked };
  }

  // --- Reports ---------------------------------------------------------------------------

  /** "Test the connection": log in again, then read everything. */
  async testConnection() {
    await this.polling?.catch(() => {});
    await this.closeSession();
    this.retryAfter = 0;
    await this.pollAll();
    const message = {};
    for (const language of Object.keys(REPORT_TEXT)) {
      message[language] = this.report(language);
    }
    return message;
  }

  report(language) {
    const text = REPORT_TEXT[language];
    const status = this.connectionStatus();
    if (!this.ready() || !this.snapshot.reachable) {
      return pick(status.message ?? ERROR_TEXT[ERROR_KINDS.UNREACHABLE], language);
    }
    const lines = [
      text.connected(routerName(this.router), this.router.firmware ?? '?', this.config.username),
    ];
    const { wan, guest, segments, counts } = this.snapshot;
    if (wan?.internet === true) {
      lines.push(text.internetOn(wan.active?.label ?? '?'));
    } else if (wan?.internet === false) {
      lines.push(text.internetOff);
    } else {
      lines.push(text.internetUnknown);
    }
    lines.push(
      wan?.connections.length
        ? text.connections(
            wan.connections
              .map((item) => `${item.label} (${item.id}, ${item.connected ? text.up : text.down})`)
              .join(', '),
          )
        : text.noConnection,
    );
    if (segments.length) {
      lines.push(
        text.segments(
          segments
            .map(
              (item) =>
                `${item.label} (${item.id}, ${text.kinds[networkKind(item.securityLevel)]}, ${text.accessPoints(item.accessPoints.length)})`,
            )
            .join(', '),
        ),
      );
    }
    if (this.config.invalidGuest) {
      lines.push(text.guestInvalid);
    } else if (guest) {
      const name = guest.ssid ? `${guest.ssid}, ${guest.id}` : guest.id;
      lines.push(guest.enabled ? text.guestOn(name) : text.guestOff(name));
    } else {
      lines.push(this.config.guestSegment ? text.guestMissing : text.guestNone);
    }
    lines.push(text.clients(counts.hosts ?? '–', counts.wifi ?? '–'));
    const gaps = [...new Set(this.snapshot.gaps.map((gap) => gap.what))];
    if (gaps.length) {
      lines.push(`${text.notRead}${language === 'fr' ? ' : ' : ': '}${gaps.join(', ')}`);
    }
    lines.push(this.config.allowCommands ? text.commandsOn : text.commandsOff);
    return lines.join('\n').slice(0, 2000);
  }
}
