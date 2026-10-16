// -----------------------------------------------------------------------------
// Readers of the RCI answers, into the plain values the hub needs. Every
// reader tolerates a missing or oddly typed field (an older KeeneticOS, another
// model): it gives null rather than throwing.
//
// Shapes as answered by KeeneticOS 4 and 5 (test/fixtures/keenetic/README.md).
// -----------------------------------------------------------------------------

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const number = (value) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};
const yes = (value) => value === true || value === 'yes' || value === 'up';

/** "AA-BB-CC-DD-EE-FF" or "aa:bb:…" → "aa:bb:cc:dd:ee:ff", else null. */
export function normalizeMac(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || /^0+$/.test(hex)) {
    return null;
  }
  return hex.match(/../g).join(':');
}

/** show version → firmware and model. */
export function parseVersion(answer) {
  const source = isRecord(answer) ? answer : {};
  return {
    firmware: text(source.title) ?? text(source.release),
    release: text(source.release),
    model: text(source.model) ?? text(source.description),
    hwId: text(source.hw_id),
    device: text(source.device),
  };
}

/** show identification → the hardware identity, when this KeeneticOS has it. */
export function parseIdentification(answer) {
  const source = isRecord(answer) ? answer : {};
  return { mac: normalizeMac(source.mac), serial: text(source.serial) };
}

/**
 * show system → load, memory, uptime.
 * `memory` is "used/total" in kB, as the web interface shows it.
 */
export function parseSystem(answer) {
  const source = isRecord(answer) ? answer : {};
  let memoryUsage = null;
  const memory = typeof source.memory === 'string' ? source.memory.split('/') : [];
  if (memory.length === 2) {
    const [used, total] = memory.map(Number);
    if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
      memoryUsage = Math.round((used / total) * 100);
    }
  }
  if (memoryUsage === null) {
    const total = number(source.memtotal);
    const free = number(source.memfree);
    if (total && free !== null) {
      const cached = (number(source.membuffers) ?? 0) + (number(source.memcache) ?? 0);
      memoryUsage = Math.round(((total - free - cached) / total) * 100);
    }
  }
  const cpuLoad = number(source.cpuload);
  return {
    cpuLoad: cpuLoad === null ? null : Math.max(0, Math.min(100, Math.round(cpuLoad))),
    memoryUsage: memoryUsage === null ? null : Math.max(0, Math.min(100, memoryUsage)),
    uptimeSeconds: number(source.uptime),
    hostname: text(source.hostname),
  };
}

// Interfaces that carry Internet through another one: a VPN marked "use for
// Internet access" is no Internet connection of its own, and switching to it
// is no failover. PPPoE, L2TP and PPTP stay: an ISP may log in with them.
const TUNNEL_TYPES = new Set([
  'Wireguard',
  'OpenVPN',
  'OpenVpn',
  'IKE',
  'Ike',
  'IPsec',
  'Ipsec',
  'SSTP',
  'Sstp',
  'Gre',
  'Eoip',
  'Ipip',
  'ZeroTier',
  'Zerotier',
  'Proxy',
]);

// Mobile connections (USB and built-in modems), for the label of the backup.
const MOBILE_TYPES = /^(UsbLte|UsbQmi|UsbModem|UsbMbim|UsbNcm|Yota|Lte|Cellular|Mobile)/i;

/**
 * show interface → the interfaces, flat. The answer is an object keyed by id;
 * switch ports appear in it too and are skipped.
 */
export function parseInterfaces(answer) {
  const list = [];
  for (const [key, raw] of Object.entries(isRecord(answer) ? answer : {})) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = text(raw.id) ?? key;
    const type = text(raw.type);
    if (!type || type === 'Port' || id !== key) {
      continue;
    }
    list.push({
      id,
      type,
      name: text(raw['interface-name']),
      description: text(raw.description),
      // `state` is the administrative state (up / down), `link` the carrier,
      // `connected` whether the connection is established.
      enabled: raw.state === 'up',
      link: yes(raw.link),
      connected: yes(raw.connected),
      global: raw.global === true,
      priority: number(raw.priority),
      defaultGateway: raw.defaultgw === true,
      via: text(raw.via),
      group: text(raw.group),
      ssid: text(raw.ssid),
      securityLevel: text(raw['security-level']),
      mac: normalizeMac(raw.mac),
      mobile: MOBILE_TYPES.test(type),
      tunnel: TUNNEL_TYPES.has(type),
    });
  }
  return list;
}

/** What a user calls an interface: its description, else its name, else its id. */
export function interfaceLabel(item) {
  if (!item) {
    return null;
  }
  const name = item.name && item.name !== item.id ? item.name : null;
  return (item.description ?? name ?? item.id).slice(0, 40);
}

/**
 * The Internet connections, the preferred one first: the interfaces marked
 * global (KeeneticOS fails over between them by priority), without the VPN
 * tunnels, and without an interface another one runs over (the Ethernet port
 * under a PPPoE session).
 */
export function wanConnections(interfaces) {
  const candidates = interfaces.filter((item) => item.global && !item.tunnel);
  const carriers = new Set(candidates.map((item) => item.via).filter(Boolean));
  return candidates
    .filter((item) => !carriers.has(item.id))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
}

/**
 * The network segments (bridges) with their Wi-Fi access points. KeeneticOS
 * gives the home segment the "private" security level and the guest segment
 * (the "Guest network" of the web interface) the "protected" one.
 */
export function parseSegments(interfaces) {
  const bridges = interfaces.filter((item) => item.type === 'Bridge');
  return bridges.map((bridge) => ({
    id: bridge.id,
    label: interfaceLabel(bridge),
    securityLevel: bridge.securityLevel,
    accessPoints: interfaces
      .filter((item) => item.type === 'AccessPoint' && item.group === bridge.id)
      .map((item) => ({ id: item.id, ssid: item.ssid, enabled: item.enabled, link: item.link })),
  }));
}

/** "home", "guest" or "other", from the security level of a segment. */
export function networkKind(securityLevel) {
  if (securityLevel === 'private') {
    return 'home';
  }
  if (securityLevel === 'protected') {
    return 'guest';
  }
  return 'other';
}

/**
 * show ip hotspot → the hosts the router knows (registered or not).
 * `active` is the router's own judgement that the host is on the network now
 * (seen on its port or its Wi-Fi, mesh extenders included).
 */
export function parseHosts(answer) {
  const rows = isRecord(answer) && Array.isArray(answer.host) ? answer.host : [];
  const hosts = [];
  for (const raw of rows) {
    const mac = normalizeMac(raw?.mac);
    if (!mac) {
      continue;
    }
    const ip = text(raw.ip);
    hosts.push({
      mac,
      ip: ip && ip !== '0.0.0.0' ? ip : null,
      hostName: text(raw.name) ?? text(raw.hostname),
      registered: raw.registered === true,
      denied: raw.access === 'deny',
      active: raw.active === true,
      wifi: Boolean(text(raw.ssid) || text(raw.ap)),
      ssid: text(raw.ssid),
      segment: isRecord(raw.interface) ? text(raw.interface.id) : null,
    });
  }
  return hosts;
}

/** show associations → the Wi-Fi stations of the router's own access points. */
export function parseStations(answer) {
  const rows = isRecord(answer) && Array.isArray(answer.station) ? answer.station : [];
  return rows
    .map((raw) => ({
      mac: normalizeMac(raw?.mac),
      ap: text(raw?.ap),
      authenticated: raw?.authenticated === true,
    }))
    .filter((station) => station.mac);
}

/** show internet status → whether the router reaches the Internet, and through what. */
export function parseInternet(answer) {
  const source = isRecord(answer) ? answer : {};
  return {
    internet: typeof source.internet === 'boolean' ? source.internet : null,
    gateway: isRecord(source.gateway) ? text(source.gateway.interface) : null,
  };
}

/** show interface stat → the byte counters of an interface. */
export function parseStat(answer) {
  const source = isRecord(answer) ? answer : {};
  return { rxBytes: number(source.rxbytes), txBytes: number(source.txbytes) };
}

/** ip hotspot host (the configuration branch) → the access rule of a MAC address. */
export function hostAccess(answer, mac) {
  const rows = Array.isArray(answer) ? answer : [];
  const row = rows.find((item) => normalizeMac(item?.mac) === mac);
  if (!row) {
    return null;
  }
  if (row.access === 'deny' || row.deny === true) {
    return 'deny';
  }
  return 'permit';
}
