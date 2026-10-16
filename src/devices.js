// -----------------------------------------------------------------------------
// The Gladys devices of the integration (category/type couples of the core
// table, see test/gladys-rules.test.js):
//
//   - the router: CPU load and memory used, uptime, KeeneticOS version, the
//     number of Wi-Fi clients and of connected devices, the Internet state,
//     the connection in use with its download and upload rates, and, when the
//     router has more than one Internet connection, whether the backup one
//     (4G / 5G, a second ISP) is up and in use; the state of the guest Wi-Fi
//     when the router has a guest segment;
//   - one presence sensor per network device the user adds from the
//     Discovery tab (presence-sensor/binary: 1 present, 0 away once the
//     departure delay has passed).
//
// Nothing is controllable as a device feature: the guest Wi-Fi state is
// input/binary, read-only on purpose. The commands go through the scene
// actions and the widget buttons, never through a switch a voice assistant
// could flip.
//
// Identities (external ids, permanent):
//   - the router: the MAC address of its home segment (Bridge0), else of
//     `show identification`. Never the address typed in the configuration;
//   - a network device: its MAC address.
//
// Every device is published with should_poll: false: the integration reads
// the router on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPES = Object.freeze({
  ROUTER: 'router',
  CLIENT: 'client',
});

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  CPU: 'cpu_load',
  MEMORY: 'memory_usage',
  UPTIME: 'uptime',
  FIRMWARE: 'firmware_version',
  INTERNET: 'internet',
  CONNECTION: 'active_connection',
  DOWNLOAD: 'wan_download',
  UPLOAD: 'wan_upload',
  BACKUP_ACTIVE: 'backup_active',
  BACKUP_LINK: 'backup_link',
  WIFI_CLIENTS: 'wifi_clients',
  CONNECTED: 'connected_devices',
  GUEST: 'guest_wifi',
  PRESENCE: 'presence',
});

// Feature and device names, in the language chosen in the configuration
// (Gladys does not tell a device integration the user's language). Frozen at
// creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.CPU]: 'CPU load',
    [FEATURE_KEYS.MEMORY]: 'Memory used',
    [FEATURE_KEYS.UPTIME]: 'Uptime',
    [FEATURE_KEYS.FIRMWARE]: 'KeeneticOS version',
    [FEATURE_KEYS.INTERNET]: 'Internet available',
    [FEATURE_KEYS.CONNECTION]: 'Connection in use',
    [FEATURE_KEYS.DOWNLOAD]: 'Download rate',
    [FEATURE_KEYS.UPLOAD]: 'Upload rate',
    [FEATURE_KEYS.BACKUP_ACTIVE]: 'Backup connection in use',
    [FEATURE_KEYS.BACKUP_LINK]: 'Backup connection up',
    [FEATURE_KEYS.WIFI_CLIENTS]: 'Wi-Fi clients',
    [FEATURE_KEYS.CONNECTED]: 'Connected devices',
    [FEATURE_KEYS.GUEST]: 'Guest Wi-Fi enabled',
    [FEATURE_KEYS.PRESENCE]: 'Presence',
    none: 'None',
    client: (mac) => `Device ${mac}`,
  },
  fr: {
    [FEATURE_KEYS.CPU]: 'Charge du processeur',
    [FEATURE_KEYS.MEMORY]: 'Mémoire utilisée',
    [FEATURE_KEYS.UPTIME]: 'Temps de fonctionnement',
    [FEATURE_KEYS.FIRMWARE]: 'Version de KeeneticOS',
    [FEATURE_KEYS.INTERNET]: 'Internet disponible',
    [FEATURE_KEYS.CONNECTION]: 'Connexion utilisée',
    [FEATURE_KEYS.DOWNLOAD]: 'Débit descendant',
    [FEATURE_KEYS.UPLOAD]: 'Débit montant',
    [FEATURE_KEYS.BACKUP_ACTIVE]: 'Connexion de secours utilisée',
    [FEATURE_KEYS.BACKUP_LINK]: 'Connexion de secours établie',
    [FEATURE_KEYS.WIFI_CLIENTS]: 'Clients Wi-Fi',
    [FEATURE_KEYS.CONNECTED]: 'Appareils connectés',
    [FEATURE_KEYS.GUEST]: 'Wi-Fi invité activé',
    [FEATURE_KEYS.PRESENCE]: 'Présence',
    none: 'Aucune',
    client: (mac) => `Appareil ${mac}`,
  },
  de: {
    [FEATURE_KEYS.CPU]: 'CPU-Last',
    [FEATURE_KEYS.MEMORY]: 'Belegter Speicher',
    [FEATURE_KEYS.UPTIME]: 'Betriebszeit',
    [FEATURE_KEYS.FIRMWARE]: 'KeeneticOS-Version',
    [FEATURE_KEYS.INTERNET]: 'Internet verfügbar',
    [FEATURE_KEYS.CONNECTION]: 'Genutzte Verbindung',
    [FEATURE_KEYS.DOWNLOAD]: 'Download-Rate',
    [FEATURE_KEYS.UPLOAD]: 'Upload-Rate',
    [FEATURE_KEYS.BACKUP_ACTIVE]: 'Ersatzverbindung in Nutzung',
    [FEATURE_KEYS.BACKUP_LINK]: 'Ersatzverbindung aufgebaut',
    [FEATURE_KEYS.WIFI_CLIENTS]: 'WLAN-Clients',
    [FEATURE_KEYS.CONNECTED]: 'Verbundene Geräte',
    [FEATURE_KEYS.GUEST]: 'Gäste-WLAN aktiviert',
    [FEATURE_KEYS.PRESENCE]: 'Anwesenheit',
    none: 'Keine',
    client: (mac) => `Gerät ${mac}`,
  },
  es: {
    [FEATURE_KEYS.CPU]: 'Carga del procesador',
    [FEATURE_KEYS.MEMORY]: 'Memoria usada',
    [FEATURE_KEYS.UPTIME]: 'Tiempo de funcionamiento',
    [FEATURE_KEYS.FIRMWARE]: 'Versión de KeeneticOS',
    [FEATURE_KEYS.INTERNET]: 'Internet disponible',
    [FEATURE_KEYS.CONNECTION]: 'Conexión en uso',
    [FEATURE_KEYS.DOWNLOAD]: 'Velocidad de descarga',
    [FEATURE_KEYS.UPLOAD]: 'Velocidad de subida',
    [FEATURE_KEYS.BACKUP_ACTIVE]: 'Conexión de respaldo en uso',
    [FEATURE_KEYS.BACKUP_LINK]: 'Conexión de respaldo establecida',
    [FEATURE_KEYS.WIFI_CLIENTS]: 'Clientes Wi-Fi',
    [FEATURE_KEYS.CONNECTED]: 'Dispositivos conectados',
    [FEATURE_KEYS.GUEST]: 'Wi-Fi de invitados activado',
    [FEATURE_KEYS.PRESENCE]: 'Presencia',
    none: 'Ninguna',
    client: (mac) => `Dispositivo ${mac}`,
  },
};

export const names = (language) => NAMES[language] ?? NAMES.en;

// Display bounds (the core never applies them on write).
const MAX_RATE_MBPS = 100_000;
const MAX_UPTIME_HOURS = 100_000;
const MAX_CLIENTS = 1000;

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});

const binary = () =>
  sensor({
    category: DEVICE_FEATURE_CATEGORIES.INPUT,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
  });

const counter = (definition = {}) =>
  sensor({
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max: MAX_CLIENTS,
    ...definition,
  });

const textFeature = () =>
  sensor({
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    keep_history: false,
    min: 0,
    max: 0,
  });

const rate = () =>
  sensor({
    category: DEVICE_FEATURE_CATEGORIES.DATARATE,
    type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
    unit: DEVICE_FEATURE_UNITS.MEGABITS_PER_SECOND,
    min: 0,
    max: MAX_RATE_MBPS,
  });

/** A text usable in an external id: lowercase letters, digits and dashes. */
export function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** The identifier of a network device: its MAC address, lowercase. */
export const clientPlatformId = (mac) => mac.toLowerCase();

export const routerIds = (gladys, routerId) => gladys.externalIds(DEVICE_TYPES.ROUTER, routerId);
export const clientIds = (gladys, mac) =>
  gladys.externalIds(DEVICE_TYPES.CLIENT, clientPlatformId(mac));

/**
 * What kind of device an external id is, and its platform id.
 * @returns {{ type: string, id: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (externalId.startsWith(prefix) && externalId.length > prefix.length) {
      return { type, id: externalId.slice(prefix.length) };
    }
  }
  return null;
}

/** The name of the router device: "Keenetic Giga", or its host name. */
export function routerName(router) {
  const model = router.device ?? router.model;
  if (model) {
    return (/keenetic/i.test(model) ? model : `Keenetic ${model}`).slice(0, 60);
  }
  return (router.hostname ?? 'Keenetic').slice(0, 60);
}

/**
 * The features of the router device.
 * @param {object} gladys
 * @param {object} router { id, hasFirmware, backup: boolean, guest: boolean, hasHosts, hasStations }
 * @param {string} language
 */
export function routerFeatures(gladys, router, language) {
  const ids = routerIds(gladys, router.id);
  const n = names(language);
  const feature = (key, definition) => ({
    ...definition,
    name: n[key],
    external_id: ids.feature(key),
  });
  const features = [
    feature(FEATURE_KEYS.CPU, counter({ unit: DEVICE_FEATURE_UNITS.PERCENT, max: 100 })),
    feature(FEATURE_KEYS.MEMORY, counter({ unit: DEVICE_FEATURE_UNITS.PERCENT, max: 100 })),
    feature(
      FEATURE_KEYS.UPTIME,
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.HOURS,
        min: 0,
        max: MAX_UPTIME_HOURS,
        // A counter that only grows: its history says nothing a reboot would not.
        keep_history: false,
      }),
    ),
  ];
  if (router.hasFirmware) {
    features.push(feature(FEATURE_KEYS.FIRMWARE, textFeature()));
  }
  features.push(
    feature(FEATURE_KEYS.INTERNET, binary()),
    feature(FEATURE_KEYS.CONNECTION, textFeature()),
    feature(FEATURE_KEYS.DOWNLOAD, rate()),
    feature(FEATURE_KEYS.UPLOAD, rate()),
  );
  if (router.backup) {
    features.push(
      feature(FEATURE_KEYS.BACKUP_ACTIVE, binary()),
      feature(FEATURE_KEYS.BACKUP_LINK, binary()),
    );
  }
  if (router.hasStations) {
    features.push(feature(FEATURE_KEYS.WIFI_CLIENTS, counter()));
  }
  if (router.hasHosts) {
    features.push(feature(FEATURE_KEYS.CONNECTED, counter()));
  }
  if (router.guest) {
    features.push(feature(FEATURE_KEYS.GUEST, binary()));
  }
  return features;
}

/**
 * The discovery payload of the router.
 * @param {object} router see routerFeatures(), plus { host, model }
 */
export function buildRouterDevice(gladys, router, language) {
  return {
    name: routerName(router),
    external_id: routerIds(gladys, router.id).device,
    model: router.model ?? undefined,
    should_poll: false,
    params: [
      { name: 'ROUTER_ADDRESS', value: router.host },
      ...(router.model ? [{ name: 'MODEL', value: router.model }] : []),
    ],
    features: routerFeatures(gladys, router, language),
  };
}

/** The name proposed for a network device: its name in the router, else its MAC. */
export function clientName(client, language) {
  return client.hostName ?? names(language).client(client.mac);
}

/**
 * The discovery payload of a network device.
 * @param {object} client { mac, ip, hostName }
 */
export function buildClientDevice(gladys, client, language) {
  const ids = clientIds(gladys, client.mac);
  return {
    name: clientName(client, language).slice(0, 60),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'MAC_ADDRESS', value: client.mac },
      ...(client.ip ? [{ name: 'IP_ADDRESS', value: client.ip }] : []),
    ],
    features: [
      {
        name: names(language)[FEATURE_KEYS.PRESENCE],
        external_id: ids.feature(FEATURE_KEYS.PRESENCE),
        ...sensor({
          category: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      },
    ],
  };
}

/** The value of a param of a device received from Gladys. */
export const paramOf = (device, name) =>
  (device?.params ?? []).find((param) => param.name === name)?.value ?? null;
