// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+):
//
//   - `router`: the health of the router (CPU, memory), the rates of the
//     connection in use, the connected devices, the state of Internet, of the
//     backup connection and of the guest Wi-Fi, the uptime and the KeeneticOS
//     version; when the commands are allowed, a Guest Wi-Fi button and a
//     Reboot button, both with confirmation;
//   - `presence`: the devices followed as presence sensors, present first,
//     with the ones whose Internet access is blocked.
//
// Every figure is sent as a value, not bound to a device feature: the widgets
// work before the devices are added to Gladys. Budget of the core: 8
// components, 6 tiles, 2 texts, 1 status list (10 rows), 4 buttons.
// (Adapted from guim31/gladys-openwrt.)
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, clientIds, parseDeviceId, routerName } from './devices.js';
import { WIDGET_KEYS } from './hub.js';
import { ERROR_KINDS } from './keenetic/errors.js';
import { normalizeMac } from './keenetic/model.js';
import { CONNECTION_TEXT, ERROR_TEXT, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  REBOOT: 'reboot',
  GUEST: 'guest_wifi',
});
const MAX_ROWS = 10;
const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  noHost: {
    en: 'Enter the address of your Keenetic router in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre routeur Keenetic dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Keenetic-Routers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su router Keenetic en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first reading of the router…',
    fr: 'En attente de la première lecture du routeur…',
    de: 'Warte auf die erste Abfrage des Routers…',
    es: 'Esperando la primera lectura del router…',
  },
  noClient: {
    en: 'No device followed: add them from the Discovery tab of the integration.',
    fr: "Aucun appareil suivi : ajoutez-les depuis l'onglet Découverte de l'intégration.",
    de: 'Kein Gerät verfolgt: Füge sie im Tab „Entdecken“ der Integration hinzu.',
    es: 'Ningún dispositivo seguido: añádalos desde la pestaña Descubrir de la integración.',
  },
  nobody: {
    en: 'No followed device is present.',
    fr: "Aucun appareil suivi n'est présent.",
    de: 'Kein verfolgtes Gerät ist anwesend.',
    es: 'Ningún dispositivo seguido está presente.',
  },
  more: {
    en: 'more devices',
    fr: 'autres appareils',
    de: 'weitere Geräte',
    es: 'dispositivos más',
  },
  cpu: { en: 'CPU', fr: 'Processeur', de: 'CPU', es: 'Procesador' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  download: { en: 'Download', fr: 'Descendant', de: 'Download', es: 'Descarga' },
  upload: { en: 'Upload', fr: 'Montant', de: 'Upload', es: 'Subida' },
  devices: { en: 'Devices', fr: 'Appareils', de: 'Geräte', es: 'Dispositivos' },
  present: { en: 'Present', fr: 'Présents', de: 'Anwesend', es: 'Presentes' },
  internet: { en: 'Internet', fr: 'Internet', de: 'Internet', es: 'Internet' },
  backup: {
    en: 'Backup connection',
    fr: 'Connexion de secours',
    de: 'Ersatzverbindung',
    es: 'Conexión de respaldo',
  },
  uptime: {
    en: 'Uptime',
    fr: 'Allumé depuis',
    de: 'Betriebszeit',
    es: 'Encendido desde hace',
  },
  version: { en: 'KeeneticOS', fr: 'KeeneticOS', de: 'KeeneticOS', es: 'KeeneticOS' },
  guest: {
    en: 'Guest Wi-Fi',
    fr: 'Wi-Fi invité',
    de: 'Gäste-WLAN',
    es: 'Wi-Fi de invitados',
  },
  available: { en: 'Available', fr: 'Disponible', de: 'Verfügbar', es: 'Disponible' },
  unavailable: { en: 'Unavailable', fr: 'Coupé', de: 'Getrennt', es: 'Cortado' },
  inUse: { en: 'In use', fr: 'Utilisée', de: 'In Nutzung', es: 'En uso' },
  standby: { en: 'Ready', fr: 'Prête', de: 'Bereit', es: 'Preparada' },
  linkDown: { en: 'Down', fr: 'Coupée', de: 'Getrennt', es: 'Cortada' },
  guestOn: { en: 'Enabled', fr: 'Activé', de: 'Aktiviert', es: 'Activado' },
  guestOff: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Desactivado' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  isPresent: { en: 'Present', fr: 'Présent', de: 'Anwesend', es: 'Presente' },
  isAway: { en: 'Away', fr: 'Absent', de: 'Abwesend', es: 'Ausente' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  blocked: { en: 'blocked', fr: 'bloqué', de: 'gesperrt', es: 'bloqueado' },
  reboot: { en: 'Reboot', fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar' },
};

// Short time units, for "Away · 2 h" and the uptime.
const UNITS = {
  en: { m: 'min', h: 'h', d: 'd' },
  fr: { m: 'min', h: 'h', d: 'j' },
  de: { m: 'min', h: 'h', d: 'T' },
  es: { m: 'min', h: 'h', d: 'd' },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    reboot: 'The router is restarting: the network is back in two to three minutes.',
    guestOn: 'Guest Wi-Fi enabled.',
    guestOff: 'Guest Wi-Fi disabled.',
  },
  fr: {
    reboot: 'Le routeur redémarre : le réseau revient dans deux à trois minutes.',
    guestOn: 'Wi-Fi invité activé.',
    guestOff: 'Wi-Fi invité désactivé.',
  },
  de: {
    reboot: 'Der Router startet neu: Das Netzwerk ist in zwei bis drei Minuten zurück.',
    guestOn: 'Gäste-WLAN aktiviert.',
    guestOff: 'Gäste-WLAN deaktiviert.',
  },
  es: {
    reboot: 'El router se está reiniciando: la red vuelve en dos o tres minutos.',
    guestOn: 'Wi-Fi de invitados activado.',
    guestOff: 'Wi-Fi de invitados desactivado.',
  },
};

const t = (table, language) => pick(table, language);
export const fit = (value, max) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** "2 h", "3 j 4 h", "12 min". */
export function shortDuration(seconds, language) {
  const units = UNITS[language] ?? UNITS.en;
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) {
    return `${minutes} ${units.m}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${units.h}`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} ${units.d} ${rest} ${units.h}` : `${days} ${units.d}`;
}

const rate = (value) => (value === null || value === undefined ? '–' : value.toFixed(1));

function message(table, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(table, language) }],
  };
}

const ttlOf = (hub) => Math.max(10, Math.min(3600, Math.round(hub.config.pollIntervalMs / 1000)));

/** The text of a configuration that cannot work yet, or null. */
function notConfigured(hub) {
  if (!hub.config.host) {
    return TEXT.noHost;
  }
  if (!hub.config.username) {
    return CONNECTION_TEXT.noUser;
  }
  return null;
}

// --- router ------------------------------------------------------------------------

async function getRouter(hub, { language = 'en' }) {
  const missing = notConfigured(hub);
  if (missing) {
    return message(missing, language);
  }
  if (!hub.router || hub.snapshot.reachable === null) {
    return message(TEXT.waiting, language, 30);
  }
  const components = [];
  if (!hub.snapshot.reachable) {
    const kind = hub.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE;
    components.push(
      { type: 'text', variant: 'body', text: fit(pick(ERROR_TEXT[kind], language), 300) },
      {
        type: 'status',
        items: [
          {
            label: fit(routerName(hub.router), 40),
            icon: 'alert-triangle',
            value: t(kind === ERROR_KINDS.UNREACHABLE ? TEXT.unreachable : TEXT.error, language),
            color: WIDGET_COLORS.DANGER,
          },
        ],
      },
    );
    return { ttl_seconds: ttlOf(hub), components };
  }

  const { system, wan, guest, counts } = hub.snapshot;
  if (system?.cpuLoad !== null && system?.cpuLoad !== undefined) {
    components.push({
      type: 'value',
      value: system.cpuLoad,
      unit: '%',
      label: t(TEXT.cpu, language),
      icon: 'cpu',
    });
  }
  if (system?.memoryUsage !== null && system?.memoryUsage !== undefined) {
    components.push({
      type: 'value',
      value: system.memoryUsage,
      unit: '%',
      label: t(TEXT.memory, language),
      icon: 'database',
    });
  }
  if (wan) {
    components.push(
      {
        type: 'value',
        value: rate(wan.download),
        unit: 'Mbit/s',
        label: t(TEXT.download, language),
        icon: 'arrow-down',
        color: WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        value: rate(wan.upload),
        unit: 'Mbit/s',
        label: t(TEXT.upload, language),
        icon: 'arrow-up',
        color: WIDGET_COLORS.INFO,
      },
    );
  }
  if (counts.hosts !== null && counts.hosts !== undefined) {
    components.push({
      type: 'value',
      value: counts.hosts,
      label: t(TEXT.devices, language),
      icon: 'monitor',
    });
  }

  const items = [];
  if (wan && wan.internet !== null) {
    items.push({
      label: t(TEXT.internet, language),
      icon: wan.internet ? 'globe' : 'x-circle',
      value: fit(
        wan.internet
          ? `${t(TEXT.available, language)}${wan.active ? ` · ${wan.active.label}` : ''}`
          : t(TEXT.unavailable, language),
        40,
      ),
      color: wan.internet ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    });
  }
  if (hub.router.backup && wan?.backup) {
    const value = wan.backupActive
      ? TEXT.inUse
      : wan.backup.connected
        ? TEXT.standby
        : TEXT.linkDown;
    items.push({
      label: fit(`${t(TEXT.backup, language)} · ${wan.backup.label}`, 40),
      icon: wan.backupActive ? 'alert-circle' : 'shield',
      value: t(value, language),
      color: wan.backupActive
        ? WIDGET_COLORS.WARNING
        : wan.backup.connected
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (hub.router.guest && guest) {
    items.push({
      label: fit(
        guest.ssid ? `${t(TEXT.guest, language)} · ${guest.ssid}` : t(TEXT.guest, language),
        40,
      ),
      icon: guest.enabled ? ACTIVE_ICON : 'circle',
      value: t(guest.enabled ? TEXT.guestOn : TEXT.guestOff, language),
      color: guest.enabled ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (system?.uptimeSeconds !== null && system?.uptimeSeconds !== undefined) {
    items.push({
      label: t(TEXT.uptime, language),
      icon: 'clock',
      value: shortDuration(system.uptimeSeconds, language),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (hub.router.firmware) {
    items.push({
      label: t(TEXT.version, language),
      icon: 'package',
      value: fit(hub.router.firmware, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (items.length) {
    components.push({ type: 'status', items: items.slice(0, MAX_ROWS) });
  }
  if (hub.config.allowCommands) {
    if (hub.router.guest && guest) {
      components.push({
        type: 'button',
        label: t(TEXT.guest, language),
        // The current state is the icon (never the style: `primary` is
        // invisible in dark mode); the tap asks for the other state.
        icon: guest.enabled ? ACTIVE_ICON : 'circle',
        style: 'secondary',
        action: { key: ACTIONS.GUEST, params: { enabled: !guest.enabled }, confirm: true },
      });
    }
    components.push({
      type: 'button',
      label: t(TEXT.reboot, language),
      icon: 'refresh-cw',
      style: 'danger',
      action: { key: ACTIONS.REBOOT, confirm: true },
    });
  }
  return { ttl_seconds: ttlOf(hub), components };
}

const toasts = (key) =>
  Object.fromEntries(Object.entries(DONE_TEXT).map(([language, table]) => [language, table[key]]));

async function actRouter(hub, { actionKey, params = {} }) {
  if (actionKey === ACTIONS.REBOOT) {
    await hub.reboot();
    return { message: toasts('reboot') };
  }
  if (actionKey === ACTIONS.GUEST) {
    const enabled = params.enabled === true || params.enabled === 'true';
    await hub.setGuest(enabled);
    return { message: toasts(enabled ? 'guestOn' : 'guestOff') };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

// --- presence ----------------------------------------------------------------------

/** The followed devices, with their Gladys name, their presence and their access. */
export function presenceRows(hub) {
  const now = hub.now();
  return hub
    .createdDevices(DEVICE_TYPES.CLIENT)
    .map((device) => {
      const mac = normalizeMac(parseDeviceId(hub.gladys, device.external_id).id);
      const record = mac ? hub.presence.get(mac) : null;
      return {
        name: device.name || mac || '?',
        present: record?.present ?? null,
        // Away since it was last seen (nothing when never seen since the start).
        since: record?.present === 0 ? (record.lastSeen ?? null) : null,
        blocked: mac ? hub.clients.get(mac)?.denied === true : false,
        now,
        externalId: mac ? clientIds(hub.gladys, mac).device : device.external_id,
      };
    })
    .sort(
      (a, b) =>
        (b.present === 1) - (a.present === 1) ||
        (b.present === 0) - (a.present === 0) ||
        a.name.localeCompare(b.name),
    );
}

async function getPresence(hub, { settings = {}, language = 'en' }) {
  const missing = notConfigured(hub);
  if (missing) {
    return message(missing, language);
  }
  const all = presenceRows(hub);
  if (all.length === 0) {
    return message(TEXT.noClient, language);
  }
  const rows = settings.show === 'present' ? all.filter((row) => row.present === 1) : all;
  const presentCount = all.filter((row) => row.present === 1).length;
  const components = [
    {
      type: 'value',
      value: presentCount,
      unit: `/ ${all.length}`.slice(0, 6),
      label: t(TEXT.present, language),
      icon: 'users',
      color: presentCount ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (!hub.snapshot.reachable && hub.snapshot.reachable !== null) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(
        `${t(TEXT.unreachable, language)} · ${hub.router ? routerName(hub.router) : hub.config.host}`,
        80,
      ),
    });
  }
  if (rows.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nobody, language) });
    return { ttl_seconds: 60, components };
  }
  const blocked = (row) => (row.blocked ? ` · ${t(TEXT.blocked, language)}` : '');
  components.push({
    type: 'status',
    items: rows.slice(0, MAX_ROWS).map((row) => {
      if (row.present === 1) {
        return {
          label: fit(row.name, 40),
          icon: row.blocked ? 'slash' : 'user-check',
          value: fit(`${t(TEXT.isPresent, language)}${blocked(row)}`, 40),
          color: row.blocked ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
        };
      }
      if (row.present === 0) {
        const ago = row.since ? ` · ${shortDuration((row.now - row.since) / 1000, language)}` : '';
        return {
          label: fit(row.name, 40),
          icon: 'user-x',
          value: fit(`${t(TEXT.isAway, language)}${ago}${blocked(row)}`, 40),
          color: WIDGET_COLORS.NEUTRAL,
        };
      }
      return {
        label: fit(row.name, 40),
        icon: 'help-circle',
        value: fit(`${t(TEXT.unknown, language)}${blocked(row)}`, 40),
        color: WIDGET_COLORS.NEUTRAL,
      };
    }),
  });
  if (rows.length > MAX_ROWS && components.length < 4) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: `+${rows.length - MAX_ROWS} ${t(TEXT.more, language)}`,
    });
  }
  return { ttl_seconds: 60, components };
}

async function actPresence(_hub, { actionKey }) {
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEYS.ROUTER]: { get: getRouter, action: actRouter },
  [WIDGET_KEYS.PRESENCE]: { get: getPresence, action: actPresence },
};
