// -----------------------------------------------------------------------------
// The Keenetic client of the hub: one RCI session, the identity of the router,
// one reading per cycle (a single batch request), and the few commands the
// integration may send when the user allows them.
//
// RCI accepts a command it does not understand with an empty answer and no
// error (a field in the wrong branch changes nothing): every command is read
// back, and a command that did not take effect is an error.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, KeeneticError } from './errors.js';
import {
  hostAccess,
  parseHosts,
  parseIdentification,
  parseInterfaces,
  parseInternet,
  parseStat,
  parseStations,
  parseSystem,
  parseVersion,
} from './model.js';
import { RciSession, statusError } from './rci.js';

/** The base URL of the web interface: http://host[:port]. */
export function baseUrlOf({ host, port }) {
  const name = host.includes(':') ? `[${host}]` : host;
  return `http://${name}${port ? `:${port}` : ''}`;
}

// The batch of one reading. The first two are needed; the others may be
// refused (a user without the right) or missing (an older KeeneticOS) and
// are reported as gaps.
const READING = [
  { key: 'system', path: ['show', 'system'], required: true },
  { key: 'interfaces', path: ['show', 'interface'], required: true },
  { key: 'hotspot', path: ['show', 'ip', 'hotspot'] },
  { key: 'associations', path: ['show', 'associations'] },
  { key: 'internet', path: ['show', 'internet', 'status'] },
];

const SAVE = { path: ['system', 'configuration', 'save'] };

export class KeeneticClient {
  /**
   * @param {object} options { host, port, username, password, request, timeoutMs }
   */
  constructor(options) {
    this.session = new RciSession({
      baseUrl: baseUrlOf(options),
      username: options.username,
      password: options.password,
      request: options.request,
      timeoutMs: options.timeoutMs,
    });
  }

  open() {
    return this.session.login();
  }

  close() {
    return this.session.logout();
  }

  /** What identifies the router, read once per session. */
  async identity() {
    const [version, identification, interfaces] = await this.session.batch([
      { path: ['show', 'version'] },
      { path: ['show', 'identification'] },
      { path: ['show', 'interface'] },
    ]);
    if (version.error) {
      throw version.error;
    }
    const parsed = parseVersion(version.value);
    const id = identification.value ? parseIdentification(identification.value) : {};
    // The MAC address of the home segment (Bridge0) first: `show interface`
    // is always readable, `show identification` may be missing (an older
    // KeeneticOS) or refused, and the id must never change.
    const list = interfaces.value ? parseInterfaces(interfaces.value) : [];
    const home = list.find((item) => item.id === 'Bridge0');
    return {
      ...parsed,
      interfaces: list,
      mac: home?.mac ?? id.mac ?? null,
      serial: id.serial ?? null,
      identificationError: identification.error ?? null,
    };
  }

  /**
   * One reading of the router.
   * @param {object} [options]
   * @param {string[]} [options.counters] interfaces whose byte counters to read
   */
  async read({ counters = [] } = {}) {
    const commands = [
      ...READING,
      ...counters.map((name) => ({
        key: `stat:${name}`,
        path: ['show', 'interface', 'stat'],
        args: { name },
      })),
    ];
    const answers = await this.session.batch(commands);
    const values = {};
    const gaps = [];
    commands.forEach((item, index) => {
      const answer = answers[index];
      if (answer.error) {
        if (item.required) {
          throw answer.error;
        }
        gaps.push({ what: item.path.join(' '), kind: answer.error.kind });
        return;
      }
      values[item.key] = answer.value;
    });
    const stats = new Map();
    for (const name of counters) {
      if (values[`stat:${name}`] !== undefined) {
        stats.set(name, parseStat(values[`stat:${name}`]));
      }
    }
    return {
      system: parseSystem(values.system),
      interfaces: parseInterfaces(values.interfaces),
      hosts: values.hotspot === undefined ? null : parseHosts(values.hotspot),
      stations: values.associations === undefined ? null : parseStations(values.associations),
      internet: values.internet === undefined ? null : parseInternet(values.internet),
      stats,
      gaps,
    };
  }

  /** The interfaces only (to read a command back). */
  async interfaces() {
    return parseInterfaces(await this.session.get('show/interface'));
  }

  /** Run commands, then save the configuration so they survive a reboot. */
  async run(commands, what) {
    const answers = await this.session.batch([...commands, SAVE]);
    const failed = answers.find((answer) => answer.error);
    if (failed) {
      throw failed.error;
    }
    return what;
  }

  /**
   * Switch Wi-Fi access points on or off (the guest segment), then check
   * their administrative state.
   * @param {string[]} ids e.g. ["WifiMaster0/AccessPoint1", "WifiMaster1/AccessPoint1"]
   */
  async setAccessPoints(ids, enabled) {
    await this.run(
      ids.map((name) => ({
        path: ['interface'],
        args: enabled ? { name, up: true } : { name, down: true },
      })),
    );
    const after = await this.interfaces();
    const wrong = ids.filter((id) => after.find((item) => item.id === id)?.enabled !== enabled);
    if (wrong.length > 0) {
      throw new KeeneticError(
        ERROR_KINDS.PROTOCOL,
        `interface ${wrong.join(', ')}: still ${enabled ? 'down' : 'up'} after the command`,
      );
    }
    return after;
  }

  /**
   * Allow or deny the Internet access of a registered host (the "Block
   * access" of the web interface), then check the rule.
   */
  async setHostAccess(mac, denied) {
    await this.run([
      {
        path: ['ip', 'hotspot', 'host'],
        args: denied ? { mac, deny: true } : { mac, permit: true },
      },
    ]);
    const access = hostAccess(await this.session.get('ip/hotspot/host'), mac);
    if (access !== (denied ? 'deny' : 'permit')) {
      throw new KeeneticError(
        ERROR_KINDS.PROTOCOL,
        `ip hotspot host: the access rule is ${access ?? 'missing'} after the command`,
      );
    }
    return access;
  }

  /** Restart the router. It may hang up before answering. */
  async reboot({ timeoutMs } = {}) {
    const answer = await this.session.call('POST', '/rci/system/reboot', {}, { timeoutMs });
    const error = statusError(answer, 'system reboot');
    if (error) {
      throw error;
    }
    return answer;
  }
}

/** Open a session (log in) and return the client. */
export async function openClient(options) {
  const client = new KeeneticClient(options);
  await client.open();
  return client;
}

export { ERROR_KINDS };
