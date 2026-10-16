// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widgets (src/widgets.js):
// connection status, errors, the report of the configuration action, the
// errors of the commands. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// Product and protocol names (Keenetic, KeeneticOS, KeenDNS, RCI) stay as is.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './keenetic/errors.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address of your Keenetic router in the configuration.',
    fr: "Saisissez l'adresse de votre routeur Keenetic dans la configuration.",
    de: 'Gib die Adresse deines Keenetic-Routers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su router Keenetic en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood (local address, without https), e.g. 192.168.1.1',
    fr: 'Adresse incomprise (adresse locale, sans https), ex. 192.168.1.1',
    de: 'Adresse nicht verstanden (lokale Adresse, ohne https), z. B. 192.168.1.1',
    es: 'Dirección no válida (dirección local, sin https), p. ej. 192.168.1.1',
  },
  noUser: {
    en: 'Enter the user name and the password of a Keenetic user in the configuration.',
    fr: "Saisissez le nom d'utilisateur et le mot de passe d'un utilisateur Keenetic dans la configuration.",
    de: 'Gib den Benutzernamen und das Passwort eines Keenetic-Benutzers in der Konfiguration ein.',
    es: 'Introduzca el nombre de usuario y la contraseña de un usuario Keenetic en la configuración.',
  },
  connecting: {
    en: 'Connecting to the router…',
    fr: 'Connexion au routeur…',
    de: 'Verbindung zum Router…',
    es: 'Conectando con el router…',
  },
};

// One short explanation per error kind (src/keenetic/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the router does not answer at this address',
    fr: 'le routeur ne répond pas à cette adresse',
    de: 'der Router antwortet unter dieser Adresse nicht',
    es: 'el router no responde en esta dirección',
  },
  [ERROR_KINDS.NOT_KEENETIC]: {
    en: 'no Keenetic web interface here: use its local address, not KeenDNS',
    fr: "pas d'interface web Keenetic ici : utilisez son adresse locale, pas KeenDNS",
    de: 'keine Keenetic-Weboberfläche hier: Nutze die lokale Adresse, nicht KeenDNS',
    es: 'no hay interfaz web Keenetic aquí: use su dirección local, no KeenDNS',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused by the router',
    fr: "nom d'utilisateur ou mot de passe refusé par le routeur",
    de: 'Benutzername oder Passwort vom Router abgelehnt',
    es: 'nombre de usuario o contraseña rechazados por el router',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'refused by the router: the user lacks this right',
    fr: "refusé par le routeur : l'utilisateur n'a pas ce droit",
    de: 'vom Router abgelehnt: Dem Benutzer fehlt dieses Recht',
    es: 'rechazado por el router: el usuario no tiene este permiso',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this KeeneticOS does not offer the function',
    fr: 'ce KeeneticOS ne propose pas la fonction',
    de: 'dieses KeeneticOS bietet die Funktion nicht an',
    es: 'este KeeneticOS no ofrece la función',
  },
  [ERROR_KINDS.PROTOCOL]: {
    en: 'unexpected answer from the router, see the logs',
    fr: 'réponse inattendue du routeur, voir les logs',
    de: 'unerwartete Antwort des Routers, sieh in den Protokollen nach',
    es: 'respuesta inesperada del router, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    connected: (name, version, user) => `Connected to ${name} (KeeneticOS ${version}) as ${user}.`,
    internetOn: (connection) => `Internet: available, through ${connection}.`,
    internetOff: 'Internet: unavailable.',
    internetUnknown: 'Internet: state not readable.',
    connections: (list) => `Internet connections, by priority: ${list}.`,
    noConnection: 'No Internet connection found among the interfaces.',
    up: 'up',
    down: 'down',
    segments: (list) => `Segments: ${list}.`,
    kinds: { home: 'home', guest: 'guest', other: 'other' },
    accessPoints: (count) => `${count} Wi-Fi`,
    guestOn: (name) => `Guest Wi-Fi (${name}): enabled.`,
    guestOff: (name) => `Guest Wi-Fi (${name}): disabled.`,
    guestNone: 'Guest Wi-Fi: no guest segment with Wi-Fi found.',
    guestMissing: 'Guest Wi-Fi: the segment of the configuration does not exist.',
    guestInvalid: 'Guest Wi-Fi: enter a segment id such as Bridge1.',
    clients: (hosts, wifi) =>
      `Seen now: ${hosts} devices online, ${wifi} on the Wi-Fi of the router.`,
    notRead: 'Not readable',
    commandsOn: 'Commands enabled.',
    commandsOff: 'Commands disabled (read only).',
  },
  fr: {
    connected: (name, version, user) =>
      `Connecté à ${name} (KeeneticOS ${version}) en tant que ${user}.`,
    internetOn: (connection) => `Internet : disponible, par ${connection}.`,
    internetOff: 'Internet : indisponible.',
    internetUnknown: 'Internet : état illisible.',
    connections: (list) => `Connexions Internet, par priorité : ${list}.`,
    noConnection: 'Aucune connexion Internet trouvée parmi les interfaces.',
    up: 'établie',
    down: 'coupée',
    segments: (list) => `Segments : ${list}.`,
    kinds: { home: 'domicile', guest: 'invités', other: 'autre' },
    accessPoints: (count) => `${count} Wi-Fi`,
    guestOn: (name) => `Wi-Fi invité (${name}) : activé.`,
    guestOff: (name) => `Wi-Fi invité (${name}) : désactivé.`,
    guestNone: 'Wi-Fi invité : aucun segment invité avec Wi-Fi trouvé.',
    guestMissing: "Wi-Fi invité : le segment de la configuration n'existe pas.",
    guestInvalid: 'Wi-Fi invité : saisissez un identifiant de segment comme Bridge1.',
    clients: (hosts, wifi) =>
      `Vus maintenant : ${hosts} appareils en ligne, ${wifi} sur le Wi-Fi du routeur.`,
    notRead: 'Illisible',
    commandsOn: 'Commandes activées.',
    commandsOff: 'Commandes désactivées (lecture seule).',
  },
  de: {
    connected: (name, version, user) =>
      `Verbunden mit ${name} (KeeneticOS ${version}) als ${user}.`,
    internetOn: (connection) => `Internet: verfügbar, über ${connection}.`,
    internetOff: 'Internet: nicht verfügbar.',
    internetUnknown: 'Internet: Zustand nicht lesbar.',
    connections: (list) => `Internetverbindungen nach Priorität: ${list}.`,
    noConnection: 'Keine Internetverbindung unter den Schnittstellen gefunden.',
    up: 'aufgebaut',
    down: 'getrennt',
    segments: (list) => `Segmente: ${list}.`,
    kinds: { home: 'Heimnetz', guest: 'Gäste', other: 'andere' },
    accessPoints: (count) => `${count} WLAN`,
    guestOn: (name) => `Gäste-WLAN (${name}): aktiviert.`,
    guestOff: (name) => `Gäste-WLAN (${name}): deaktiviert.`,
    guestNone: 'Gäste-WLAN: kein Gästesegment mit WLAN gefunden.',
    guestMissing: 'Gäste-WLAN: Das Segment der Konfiguration existiert nicht.',
    guestInvalid: 'Gäste-WLAN: Gib eine Segment-ID wie Bridge1 ein.',
    clients: (hosts, wifi) =>
      `Gerade gesehen: ${hosts} Geräte online, ${wifi} im WLAN des Routers.`,
    notRead: 'Nicht lesbar',
    commandsOn: 'Befehle aktiviert.',
    commandsOff: 'Befehle deaktiviert (nur lesen).',
  },
  es: {
    connected: (name, version, user) => `Conectado a ${name} (KeeneticOS ${version}) como ${user}.`,
    internetOn: (connection) => `Internet: disponible, por ${connection}.`,
    internetOff: 'Internet: no disponible.',
    internetUnknown: 'Internet: estado no legible.',
    connections: (list) => `Conexiones a Internet, por prioridad: ${list}.`,
    noConnection: 'No se ha encontrado ninguna conexión a Internet entre las interfaces.',
    up: 'establecida',
    down: 'cortada',
    segments: (list) => `Segmentos: ${list}.`,
    kinds: { home: 'hogar', guest: 'invitados', other: 'otro' },
    accessPoints: (count) => `${count} Wi-Fi`,
    guestOn: (name) => `Wi-Fi de invitados (${name}): activado.`,
    guestOff: (name) => `Wi-Fi de invitados (${name}): desactivado.`,
    guestNone: 'Wi-Fi de invitados: no se ha encontrado ningún segmento de invitados con Wi-Fi.',
    guestMissing: 'Wi-Fi de invitados: el segmento de la configuración no existe.',
    guestInvalid: 'Wi-Fi de invitados: introduzca un identificador de segmento como Bridge1.',
    clients: (hosts, wifi) =>
      `Vistos ahora: ${hosts} dispositivos en línea, ${wifi} en el Wi-Fi del router.`,
    notRead: 'No legible',
    commandsOn: 'Órdenes activadas.',
    commandsOff: 'Órdenes desactivadas (solo lectura).',
  },
};

// Errors of the commands (scene actions and widget buttons), shown in Gladys.
export const ACTION_TEXT = {
  disabled: {
    en: 'Commands are disabled: tick "Allow commands" in the configuration.',
    fr: 'Les commandes sont désactivées : cochez « Autoriser les commandes » dans la configuration.',
    de: 'Befehle sind deaktiviert: Aktiviere „Befehle erlauben“ in der Konfiguration.',
    es: 'Las órdenes están desactivadas: marque «Permitir órdenes» en la configuración.',
  },
  noGuest: {
    en: 'The router has no guest segment with Wi-Fi: create the guest network in its web interface.',
    fr: "Le routeur n'a aucun segment invité avec Wi-Fi : créez le réseau invité dans son interface web.",
    de: 'Der Router hat kein Gästesegment mit WLAN: Lege das Gästenetz in seiner Weboberfläche an.',
    es: 'El router no tiene ningún segmento de invitados con Wi-Fi: cree la red de invitados en su interfaz web.',
  },
  guestNotFound: {
    en: 'The guest segment of the configuration does not exist on the router, or has no Wi-Fi.',
    fr: "Le segment invité de la configuration n'existe pas sur le routeur, ou n'a pas de Wi-Fi.",
    de: 'Das Gästesegment der Konfiguration existiert auf dem Router nicht oder hat kein WLAN.',
    es: 'El segmento de invitados de la configuración no existe en el router o no tiene Wi-Fi.',
  },
  permission: {
    en: 'Refused by the router: the user is read-only. Give it the full web interface right to use the commands.',
    fr: "Refusé par le routeur : l'utilisateur est en lecture seule. Donnez-lui le droit complet sur l'interface web pour les commandes.",
    de: 'Vom Router abgelehnt: Der Benutzer darf nur lesen. Gib ihm das volle Recht auf die Weboberfläche für die Befehle.',
    es: 'Rechazado por el router: el usuario es de solo lectura. Dele el permiso completo de la interfaz web para las órdenes.',
  },
  noDevice: {
    en: 'Choose a network device followed by the integration.',
    fr: "Choisissez un appareil du réseau suivi par l'intégration.",
    de: 'Wähle ein Netzwerkgerät, das die Integration verfolgt.',
    es: 'Elija un dispositivo de red seguido por la integración.',
  },
  unknownHost: {
    en: 'The router does not know this device (never seen on its network).',
    fr: 'Le routeur ne connaît pas cet appareil (jamais vu sur son réseau).',
    de: 'Der Router kennt dieses Gerät nicht (nie in seinem Netzwerk gesehen).',
    es: 'El router no conoce este dispositivo (nunca visto en su red).',
  },
  notRegistered: {
    en: 'Register this device in the web interface of the router first (Device lists): only a registered device can be blocked.',
    fr: "Enregistrez d'abord cet appareil dans l'interface web du routeur (Device lists) : seul un appareil enregistré peut être bloqué.",
    de: 'Registriere dieses Gerät zuerst in der Weboberfläche des Routers (Device lists): Nur ein registriertes Gerät kann gesperrt werden.',
    es: 'Registre primero este dispositivo en la interfaz web del router (Device lists): solo un dispositivo registrado puede bloquearse.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, value, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${value}`;
export const pick = (table, language) => table?.[language] ?? table?.[LANGUAGE_FALLBACK] ?? '';
