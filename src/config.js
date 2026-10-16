// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Reading intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '15', '30', '60'];

export const MAX_AWAY_DELAY_MINUTES = 60;

export const DEFAULT_CONFIG = {
  host: '',
  username: '',
  password: '',
  poll_interval: '30',
  away_delay: 5,
  guest_segment: '',
  allow_commands: false,
  language: 'fr',
};

/**
 * Parse the address typed by the user: a bare IP or host name
 * (`192.0.2.1`, `my.keenetic.net`), optionally with a port (`192.0.2.1:8080`),
 * or the URL copied from the browser (`http://192.0.2.1/dashboard`). The path
 * is dropped. HTTPS is refused: the local web interface is plain HTTP, and
 * the KeenDNS HTTPS address does not offer the login challenge.
 * @param {unknown} raw
 * @returns {{ host: string, port: number|null }|null} null when unusable
 */
export function parseAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  if (hasScheme && !/^http:\/\//i.test(value)) {
    return null;
  }
  const withScheme = hasScheme ? value : `http://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (!url.hostname || url.username || url.password) {
    return null;
  }
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port ? Number(url.port) : null,
  };
}

const toBoolean = (value, fallback) => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
};

// KeeneticOS segment ids: Bridge0, Bridge1…
const SEGMENT_ID = /^Bridge\d{1,3}$/;

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const typedAddress = text('host');
  const address = parseAddress(typedAddress);

  // A number field may arrive as a string ("5", "2,5") or be left empty.
  const rawDelay =
    typeof source.away_delay === 'string'
      ? Number(source.away_delay.trim().replace(',', '.'))
      : source.away_delay;
  const awayDelay =
    typeof rawDelay === 'number' && Number.isFinite(rawDelay) && rawDelay >= 0
      ? Math.min(MAX_AWAY_DELAY_MINUTES, Math.round(rawDelay))
      : DEFAULT_CONFIG.away_delay;

  // "bridge1" or "Bridge 1" typed by hand: the id KeeneticOS uses.
  const segment = text('guest_segment').replace(/\s+/g, '');
  const segmentId = segment ? `Bridge${segment.replace(/^bridge/i, '')}` : '';

  return {
    host: address?.host ?? null,
    port: address?.port ?? null,
    invalidHost: typedAddress !== '' && address === null,
    username: text('username'),
    // Passwords are kept as typed: spaces may be part of them.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    awayDelayMs: awayDelay * 60_000,
    guestSegment: SEGMENT_ID.test(segmentId) ? segmentId : null,
    invalidGuest: segment !== '' && !SEGMENT_ID.test(segmentId),
    allowCommands: toBoolean(source.allow_commands, DEFAULT_CONFIG.allow_commands),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
