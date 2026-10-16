// -----------------------------------------------------------------------------
// An in-memory Keenetic router for the tests: the login of its web interface
// (GET /auth challenge, POST /auth, a session cookie that expires after five
// minutes without use) and its RCI interface (GET /rci/<path>, POST /rci/
// batches, POST /rci/system/reboot), served from the fixtures of
// test/fixtures/keenetic/. Users may be read-only (every command refused with
// an error status, the reading allowed) or lack some reading (a gap).
//
// `createNetwork({ host: router })` gives the `request` seam of
// src/keenetic/http.js, with the socket errors a real network raises.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/keenetic/${name}.json`, import.meta.url), 'utf8'));

const SESSION_TIMEOUT_MS = 300_000;
const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? '' : JSON.stringify(body),
});
const error = (message, code = '7405600') => ({
  status: [{ status: 'error', code, ident: 'Command::Base', message }],
});
const done = (message) => ({
  status: [{ status: 'message', code: '72', ident: 'Command::Base', message }],
});
const md5 = (text) => createHash('md5').update(text).digest('hex');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export class FakeKeenetic {
  /**
   * @param {object} [options]
   * @param {string} [options.fixture] a file of test/fixtures/keenetic/
   * @param {Record<string, { password: string, readonly?: boolean, deny?: string[] }>} [options.users]
   * @param {boolean} [options.identification] the KeeneticOS has `show identification`
   * @param {() => number} [options.now]
   */
  constructor({
    fixture: name = 'giga-4.1-pppoe-lte',
    users = { gladys: { password: 'secret' } },
    identification = true,
    now = () => Date.now(),
  } = {}) {
    this.data = structuredClone(fixture(name));
    if (!identification) {
      delete this.data['show/identification'];
    }
    this.realm = this.data['show/version']?.description ?? 'Keenetic';
    this.users = users;
    this.now = now;
    this.offline = false;
    /** cookie value → { challenge } before the login, { user, last } after. */
    this.cookies = new Map();
    this.logins = { ok: 0, failed: 0 };
    /** Every RCI command that reached the router: { path, args, user }. */
    this.calls = [];
    this.saves = 0;
    this.reboots = 0;
  }

  // --- Test controls ----------------------------------------------------------------

  goOffline() {
    this.offline = true;
  }

  goOnline() {
    this.offline = false;
  }

  /** The router forgets every session (a reboot, or five minutes without use). */
  expireSessions() {
    this.cookies.clear();
  }

  get sessions() {
    return [...this.cookies.entries()].filter(([, entry]) => entry.user).map(([key]) => key);
  }

  setCpu(load) {
    this.data['show/system'].cpuload = load;
  }

  /** Add bytes to the counters of an interface. */
  traffic(id, rxBytes, txBytes) {
    const stats = this.data['show/interface/stat'];
    stats[id] ??= { rxbytes: 0, txbytes: 0 };
    stats[id].rxbytes += rxBytes;
    stats[id].txbytes += txBytes;
  }

  /** The connection state of an interface (a cable unplugged, a PPPoE session lost). */
  setConnected(id, connected) {
    const item = this.data['show/interface'][id];
    item.connected = connected ? 'yes' : 'no';
    item.link = connected ? 'up' : 'down';
  }

  /** What `show internet status` says. */
  setInternet(internet, gateway = this.data['show/internet/status'].gateway?.interface) {
    const status = this.data['show/internet/status'];
    status.internet = internet;
    status.gateway = { ...status.gateway, interface: gateway };
  }

  host(mac) {
    return this.data['show/ip/hotspot'].host.find((item) => item.mac === mac.toLowerCase());
  }

  /** A device comes online (on a port, or on the Wi-Fi with `ap`). */
  connectHost(mac, { ap = null, ip = '192.0.2.99', name = '', registered = false } = {}) {
    let host = this.host(mac);
    if (!host) {
      host = {
        mac: mac.toLowerCase(),
        ip,
        hostname: name,
        name: '',
        registered,
        access: 'permit',
        interface: { id: 'Bridge0', name: 'Home', description: 'Home network' },
      };
      this.data['show/ip/hotspot'].host.push(host);
    }
    host.active = true;
    host.link = 'up';
    if (ap) {
      host.ssid = this.data['show/interface'][ap]?.ssid ?? 'Home';
      host.ap = ap;
      this.associate(mac, ap);
    }
    return host;
  }

  /** A device leaves: inactive in the host table, gone from the associations. */
  disconnectHost(mac) {
    const host = this.host(mac);
    if (host) {
      host.active = false;
      delete host.link;
    }
    this.dissociate(mac);
  }

  associate(mac, ap = 'WifiMaster0/AccessPoint0', { authenticated = true } = {}) {
    const stations = this.data['show/associations'].station;
    const existing = stations.find((item) => item.mac === mac.toLowerCase());
    if (existing) {
      existing.authenticated = authenticated;
      return;
    }
    stations.push({ mac: mac.toLowerCase(), ap, authenticated, rssi: -60, mode: '11ac' });
  }

  dissociate(mac) {
    const stations = this.data['show/associations'].station;
    const index = stations.findIndex((item) => item.mac === mac.toLowerCase());
    if (index >= 0) {
      stations.splice(index, 1);
    }
  }

  // --- HTTP --------------------------------------------------------------------------

  cookieOf(headers = {}) {
    const raw = headers.cookie ?? headers.Cookie ?? '';
    const match = /(?:^|;\s*)([A-Z]{8})=([0-9a-f]+)/.exec(raw);
    return match ? `${match[1]}=${match[2]}` : null;
  }

  session(cookie) {
    const entry = cookie ? this.cookies.get(cookie) : null;
    if (!entry?.user || this.now() - entry.last > SESSION_TIMEOUT_MS) {
      return null;
    }
    entry.last = this.now();
    return entry;
  }

  /** @returns {{ status: number, headers: object, body: string }} */
  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const path = new URL(url).pathname;
    const cookie = this.cookieOf(headers);
    if (path === '/auth') {
      return this.auth(method, cookie, body);
    }
    if (!path.startsWith('/rci/')) {
      return json(404, undefined);
    }
    const session = this.session(cookie);
    if (!session) {
      return json(401, undefined);
    }
    const user = this.users[session.user];
    if (method === 'GET') {
      const answer = this.show(path.slice('/rci/'.length).replace(/\/+$/, ''), user);
      return answer === undefined ? json(404, undefined) : json(200, answer);
    }
    if (method === 'POST' && path === '/rci/') {
      if (!Array.isArray(body)) {
        return json(200, this.execute(body, session.user));
      }
      return json(
        200,
        body.map((command) => this.execute(command, session.user)),
      );
    }
    if (method === 'POST' && path === '/rci/system/reboot') {
      this.calls.push({ path: 'system reboot', user: session.user });
      if (user.readonly) {
        return json(200, error('access denied: read-only user'));
      }
      this.reboots += 1;
      this.cookies.clear();
      return json(200, {});
    }
    return json(404, undefined);
  }

  auth(method, cookie, body) {
    if (method === 'DELETE') {
      if (cookie) {
        this.cookies.delete(cookie);
      }
      return json(200, {});
    }
    if (method === 'GET') {
      if (this.session(cookie)) {
        return json(200, {});
      }
      const name = cookie ?? `${'ABCDEFGH'}=${randomBytes(16).toString('hex')}`;
      const challenge = randomBytes(16).toString('hex').toUpperCase();
      this.cookies.set(name, { challenge });
      return json(401, undefined, {
        'x-ndm-realm': this.realm,
        'x-ndm-challenge': challenge,
        'set-cookie': [`${name}; Path=/; HttpOnly`],
      });
    }
    if (method === 'POST') {
      const pending = cookie ? this.cookies.get(cookie) : null;
      const user = this.users[body?.login];
      const expected =
        pending?.challenge && user
          ? sha256(`${pending.challenge}${md5(`${body.login}:${this.realm}:${user.password}`)}`)
          : null;
      if (!expected || body?.password !== expected) {
        this.logins.failed += 1;
        return json(401, undefined);
      }
      this.logins.ok += 1;
      this.cookies.set(cookie, { user: body.login, last: this.now() });
      return json(200, {});
    }
    return json(405, undefined);
  }

  /** A `show` (or a configuration branch) by its path, e.g. "show/ip/hotspot". */
  show(path, user, args = {}) {
    this.calls.push({ path: path.replaceAll('/', ' '), args });
    if (user.deny?.includes(path)) {
      return error('access denied');
    }
    if (path === 'show/interface/stat') {
      const stat = this.data['show/interface/stat']?.[args.name];
      return stat ?? error(`unable to find ${args.name}`);
    }
    if (path === 'show/interface' && args.name) {
      return this.data['show/interface'][args.name] ?? error(`unable to find ${args.name}`);
    }
    if (!(path in this.data)) {
      return path.startsWith('show/') ? error('no such command: identification') : undefined;
    }
    return structuredClone(this.data[path]);
  }

  /** One command of a batch: its answer, nested like the command. */
  execute(command, username) {
    const user = this.users[username];
    // Walk down the command to its arguments: { show: { ip: { hotspot: {} } } }.
    const path = [];
    let node = command;
    while (node && typeof node === 'object' && Object.keys(node).length === 1) {
      const [key] = Object.keys(node);
      const child = node[key];
      const isLeaf =
        typeof child !== 'object' ||
        child === null ||
        Object.keys(child).length !== 1 ||
        ['name', 'mac'].includes(Object.keys(child)[0]);
      path.push(key);
      node = child;
      if (isLeaf) {
        break;
      }
    }
    const args = node && typeof node === 'object' ? node : {};
    const nest = (answer) => path.reduceRight((inner, key) => ({ [key]: inner }), answer);
    if (path[0] === 'show') {
      return nest(this.show(path.join('/'), user, args) ?? error('no such command'));
    }
    this.calls.push({ path: path.join(' '), args, user: username });
    if (user.readonly) {
      return nest(error('access denied: read-only user'));
    }
    const key = path.join(' ');
    if (key === 'system configuration save') {
      this.saves += 1;
      return nest(done('saving configuration...'));
    }
    if (key === 'interface') {
      const item = this.data['show/interface'][args.name];
      if (!item) {
        return nest(error(`unable to find ${args.name}`));
      }
      if (args.up === true) {
        item.state = 'up';
        item.link = 'up';
        item.connected = 'yes';
      } else if (args.down === true) {
        item.state = 'down';
        item.link = 'down';
        item.connected = 'no';
      }
      return nest(done(`${args.name}: interface state changed.`));
    }
    if (key === 'ip hotspot host') {
      const rules = this.data['ip/hotspot/host'];
      const host = this.host(args.mac ?? '');
      if (!host?.registered) {
        return nest(error('host is not registered'));
      }
      let rule = rules.find((item) => item.mac === args.mac);
      if (!rule) {
        rule = { mac: args.mac };
        rules.push(rule);
      }
      const access = args.deny === true ? 'deny' : 'permit';
      delete rule.deny;
      delete rule.permit;
      rule.access = access;
      rule[access] = true;
      host.access = access;
      return nest(done(`${args.mac}: access ${access}.`));
    }
    // An unknown branch: accepted with an empty answer, changing nothing.
    return nest({});
  }
}

/** A fake network of Keenetic routers, by host. */
export function createNetwork(devices) {
  const fail = (code) => {
    const err = new Error(code);
    err.code = code;
    return err;
  };
  return {
    async request(url, options = {}) {
      const target = new URL(url);
      const device = devices[target.host] ?? devices[target.hostname];
      if (!device) {
        throw fail('EHOSTUNREACH');
      }
      if (device.offline) {
        throw fail('ETIMEDOUT');
      }
      return device.handle(url, options);
    },
  };
}
