// -----------------------------------------------------------------------------
// Presence of the network devices, from one reading of the router.
//
// A device is *seen* when the router's host table says it is active (the
// "Online" of the web interface: on a port, on the Wi-Fi of the router or of a
// mesh extender), or when it is associated and authenticated on an access
// point of the router right now. A seen device is present at once; a device
// no longer seen becomes away only once the departure delay has passed since
// it was last seen: a phone asleep drops off the Wi-Fi for a few minutes
// without leaving home.
//
// When the router cannot be read, nothing changes: an outage of the router
// never sends the whole household away. (Adapted from guim31/gladys-openwrt.)
// -----------------------------------------------------------------------------

export const SOURCES = Object.freeze({
  WIFI: 'wifi',
  WIRED: 'wired',
});

/**
 * The devices a reading shows, by MAC address.
 * @param {object} reading { hosts, stations }
 * @returns {Map<string, { mac, ip, hostName, ssid, segment, registered, denied, wifi: boolean, seen: boolean }>}
 */
export function collectClients(reading) {
  const clients = new Map();
  for (const host of reading.hosts ?? []) {
    clients.set(host.mac, {
      mac: host.mac,
      ip: host.ip,
      hostName: host.hostName,
      ssid: host.ssid,
      segment: host.segment,
      registered: host.registered,
      denied: host.denied,
      wifi: host.wifi,
      seen: host.active,
    });
  }
  for (const station of reading.stations ?? []) {
    // A station still in the WPA handshake (wrong key) is not home.
    if (!station.authenticated) {
      continue;
    }
    const client = clients.get(station.mac) ?? {
      mac: station.mac,
      ip: null,
      hostName: null,
      ssid: null,
      segment: null,
      registered: false,
      denied: false,
      wifi: true,
      seen: false,
    };
    client.seen = true;
    client.wifi = true;
    clients.set(station.mac, client);
  }
  return clients;
}

export class PresenceTracker {
  /**
   * @param {object} options
   * @param {number} options.awayDelayMs
   * @param {() => number} options.now
   */
  constructor({ awayDelayMs, now }) {
    this.awayDelayMs = awayDelayMs;
    this.now = now;
    this.startedAt = now();
    /** @type {Map<string, { present: 0|1|null, lastSeen: number|null, since: number|null }>} */
    this.records = new Map();
  }

  record(mac) {
    let record = this.records.get(mac);
    if (!record) {
      record = { present: null, lastSeen: null, since: null };
      this.records.set(mac, record);
    }
    return record;
  }

  /**
   * Apply one successful reading to the followed devices.
   * @param {string[]} followed MAC addresses of the devices added to Gladys
   * @param {Map<string, { seen: boolean }>} clients collectClients()
   * @returns {string[]} the MAC addresses whose presence changed
   */
  update(followed, clients) {
    const now = this.now();
    const changed = [];
    for (const mac of followed) {
      const record = this.record(mac);
      const before = record.present;
      if (clients.get(mac)?.seen) {
        record.lastSeen = now;
        record.present = 1;
      } else {
        // Never seen since the start: the delay counts from the start.
        const lastSeen = record.lastSeen ?? this.startedAt;
        if (record.present !== 0 && now - lastSeen >= this.awayDelayMs) {
          record.present = 0;
        }
      }
      if (record.present !== before) {
        record.since = now;
        changed.push(mac);
      }
    }
    return changed;
  }

  /** 1, 0, or null while unknown (not seen since the start, delay not over). */
  presence(mac) {
    return this.records.get(mac)?.present ?? null;
  }

  get(mac) {
    return this.records.get(mac) ?? null;
  }
}
