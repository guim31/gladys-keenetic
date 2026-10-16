#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Keenetic router, with the very client of the
// integration: `node scripts/probe.mjs <address>`.
//
//   - Without credentials, it runs the real login of the web interface with an
//     invented account and reports how the router refuses it: it checks the
//     challenge, the hashes and the error reading against a real KeeneticOS.
//   - With KEENETIC_USER and KEENETIC_PASSWORD in the environment, it logs in
//     like the integration does and runs every reading the integration runs
//     (never a command: no `interface`, no `ip hotspot host`, no reboot, no
//     configuration save).
//
// The output never shows a password, a cookie, a challenge, a MAC or IP
// address, a host name, a description nor an SSID: only versions, models,
// interface types, counts, field names and error kinds, so it can be pasted
// in an issue.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseAddress } from '../src/config.js';
import { KeeneticClient, baseUrlOf } from '../src/keenetic/client.js';
import { RciSession } from '../src/keenetic/rci.js';
import {
  networkKind,
  parseHosts,
  parseInterfaces,
  parseInternet,
  parseSegments,
  parseStations,
  parseSystem,
  wanConnections,
} from '../src/keenetic/model.js';

/** The keys of an answer, never its values. */
const shape = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().join(', ').slice(0, 300) || '-'
    : Array.isArray(value)
      ? `array of ${value.length}`
      : typeof value;

const PATHS = [
  ['show', 'version'],
  ['show', 'identification'],
  ['show', 'system'],
  ['show', 'interface'],
  ['show', 'ip', 'hotspot'],
  ['show', 'associations'],
  ['show', 'internet', 'status'],
];

/**
 * @param {object} options { host, port, username, password, request }
 * @returns {Promise<string[]>} the report lines
 */
export async function probe({ host, port = null, username, password = '', request }) {
  const lines = [];
  const baseUrl = baseUrlOf({ host, port });
  if (!username) {
    lines.push('No KEENETIC_USER: logging in with an invented account.');
    const session = new RciSession({
      baseUrl,
      username: `probe-${randomBytes(4).toString('hex')}`,
      password: randomBytes(12).toString('hex'),
      request,
      timeoutMs: 8000,
    });
    try {
      await session.login();
      lines.push('The invented account was ACCEPTED (unexpected).');
    } catch (err) {
      lines.push(`Login: ${err.kind ?? 'error'} — ${err.message}`);
      lines.push(`Challenge offered: ${session.realm ? 'yes' : 'no'}`);
    }
    return lines;
  }

  const client = new KeeneticClient({ host, port, username, password, request, timeoutMs: 8000 });
  try {
    await client.open();
  } catch (err) {
    lines.push(`No session: ${err.kind} — ${err.message}`);
    return lines;
  }
  lines.push('Login: ok');
  const raw = {};
  const answers = await client.session.batch(PATHS.map((path) => ({ path })));
  PATHS.forEach((path, index) => {
    const name = path.join(' ');
    const answer = answers[index];
    if (answer.error) {
      lines.push(`${name}: ${answer.error.kind} — ${answer.error.message}`);
    } else {
      raw[name] = answer.value;
      lines.push(`${name}: ok; fields: ${shape(answer.value)}`);
    }
  });

  const version = raw['show version'] ?? {};
  lines.push(
    `Model ${version.model ?? '?'} (${version.hw_id ?? '?'}), KeeneticOS ${version.title ?? '?'} (${version.release ?? '?'}), sandbox ${version.sandbox ?? '?'}`,
    `Hardware id found: ${raw['show identification']?.mac ? 'yes' : 'no'}`,
  );
  const system = parseSystem(raw['show system']);
  lines.push(
    `CPU ${system.cpuLoad} %, memory ${system.memoryUsage} %, uptime ${system.uptimeSeconds} s`,
  );
  const interfaces = parseInterfaces(raw['show interface']);
  const types = new Map();
  for (const item of interfaces) {
    types.set(item.type, (types.get(item.type) ?? 0) + 1);
  }
  lines.push(
    `Interfaces: ${[...types].map(([type, count]) => `${type}×${count}`).join(', ') || 'none'}`,
  );
  const global = interfaces.filter((item) => item.global);
  lines.push(
    `Global interfaces: ${
      global
        .map(
          (item) =>
            `${item.type} prio ${item.priority ?? '?'}${item.connected ? '' : ' down'}${item.defaultGateway ? ' default' : ''}${item.via ? ' via' : ''}`,
        )
        .join(', ') || 'none'
    }`,
  );
  const wan = wanConnections(interfaces);
  lines.push(
    `Internet connections kept: ${wan.map((item) => `${item.type}${item.mobile ? ' (mobile)' : ''}`).join(', ') || 'none'}`,
  );
  lines.push(
    `Segments: ${
      parseSegments(interfaces)
        .map(
          (item) =>
            `${networkKind(item.securityLevel)} (${item.securityLevel ?? '?'}) with ${item.accessPoints.length} access point(s)`,
        )
        .join(', ') || 'none'
    }`,
  );
  const hosts = parseHosts(raw['show ip hotspot']);
  lines.push(
    `Hosts: ${hosts.length} (${hosts.filter((h) => h.active).length} active, ${hosts.filter((h) => h.registered).length} registered, ${hosts.filter((h) => h.wifi).length} Wi-Fi, ${hosts.filter((h) => h.denied).length} blocked)`,
  );
  const stations = parseStations(raw['show associations']);
  lines.push(
    `Stations: ${stations.length} (${stations.filter((s) => s.authenticated).length} authenticated)`,
  );
  const internet = parseInternet(raw['show internet status']);
  const gateway = interfaces.find((item) => item.id === internet.gateway);
  lines.push(
    `Internet: ${internet.internet}, through a ${gateway?.type ?? 'unknown'} interface${gateway && !wan.includes(gateway) ? ' (not an Internet connection: a tunnel?)' : ''}`,
  );
  if (wan[0]) {
    const [stat] = await client.session.batch([
      { path: ['show', 'interface', 'stat'], args: { name: wan[0].id } },
    ]);
    lines.push(
      stat.error
        ? `show interface stat: ${stat.error.kind} — ${stat.error.message}`
        : `show interface stat: ok; fields: ${shape(stat.value)}`,
    );
  }
  await client.close();
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [address] = process.argv.slice(2);
  const parsed = parseAddress(address ?? '');
  if (!parsed) {
    console.error(
      'Usage: [KEENETIC_USER=… KEENETIC_PASSWORD=…] node scripts/probe.mjs <local address>',
    );
    process.exit(2);
  }
  const lines = await probe({
    host: parsed.host,
    port: parsed.port,
    username: process.env.KEENETIC_USER,
    password: process.env.KEENETIC_PASSWORD ?? '',
  });
  console.log(lines.join('\n'));
}
