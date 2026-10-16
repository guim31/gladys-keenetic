// -----------------------------------------------------------------------------
// The errors of the Keenetic RCI interface, sorted into a few kinds the rest
// of the code (and the user) can act on. A message never carries the password,
// its hash nor the session cookie: the client builds it from an HTTP status,
// an RCI status code or a socket code.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  // Nothing answers at this address and port (refused, timeout, no route).
  UNREACHABLE: 'unreachable',
  // Something answers, but not the web interface of a Keenetic (no /auth
  // challenge): another device, or a KeenDNS address (remote access does not
  // offer the challenge of the local network).
  NOT_KEENETIC: 'not_keenetic',
  // The router refused the user name or the password.
  AUTH: 'auth',
  // The user is logged in, but may not do this (a read-only user and a
  // command, or a user without the web interface right).
  PERMISSION: 'permission',
  // This KeeneticOS does not know the command.
  NOT_FOUND: 'not_found',
  // Any other refusal or unexpected answer.
  PROTOCOL: 'protocol',
});

export class KeeneticError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message safe to log: never a password nor a cookie
   */
  constructor(kind, message) {
    super(message);
    this.name = 'KeeneticError';
    this.kind = kind;
  }
}

// Node error codes of a peer that does not answer (or no longer does).
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
  'UND_ERR_SOCKET',
]);

/**
 * Turn a socket error into a KeeneticError.
 * @param {Error & { code?: string }} err
 * @param {string} where e.g. "GET /auth"
 */
export function networkError(err, where) {
  if (err instanceof KeeneticError) {
    return err;
  }
  const code = err?.code ?? '';
  if (UNREACHABLE_CODES.has(code)) {
    return new KeeneticError(ERROR_KINDS.UNREACHABLE, `${where}: no answer (${code})`);
  }
  if (code === 'HPE_INVALID_CONSTANT' || /^HPE_/.test(code)) {
    // Not HTTP at all on this port.
    return new KeeneticError(ERROR_KINDS.NOT_KEENETIC, `${where}: not an HTTP answer (${code})`);
  }
  return new KeeneticError(
    ERROR_KINDS.UNREACHABLE,
    `${where}: ${code || err?.message || 'connection failed'}`,
  );
}
