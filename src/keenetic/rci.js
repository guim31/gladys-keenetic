// -----------------------------------------------------------------------------
// RCI, the JSON interface of the KeeneticOS web interface (`/rci/…`), with
// the login of that web interface:
//
//   1. GET /auth answers 401 with a session cookie and two headers,
//      X-NDM-Realm and X-NDM-Challenge;
//   2. POST /auth { login, password } with that cookie, where password is
//      sha256(challenge + md5(login:realm:password)), both in lowercase hex.
//      200: the cookie is now a session; 401: refused.
//
// The password itself never travels. The session expires after a few minutes
// without use (the router answers 401 again): a request that gets a 401 logs
// in again once, then replays. (Protocol as implemented by the MIT-licensed
// salatmaster/keenetic-mcp and akinin/ha_keenetic.)
//
// RCI answers HTTP 200 even when a command fails: the failure is a `status`
// array somewhere inside the body, `{ status: "error", code, ident, message }`.
// A batch is a POST /rci/ of an array of commands, answered by an array in the
// same order, each answer nested like its command:
// `{ show: { system: {} } }` → `{ show: { system: { …answer… } } }`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { ERROR_KINDS, KeeneticError, networkError } from './errors.js';
import { httpRequest } from './http.js';

/** The answer the router expects to its challenge (lowercase hex). */
export function challengeAnswer(login, realm, password, challenge) {
  const md5 = createHash('md5').update(`${login}:${realm}:${password}`).digest('hex');
  return createHash('sha256').update(`${challenge}${md5}`).digest('hex');
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every `status` entry of an answer, however deep. The router nests them in
 * the branch of the command that produced them.
 * @returns {Array<{ status: string, code?: string, ident?: string, message?: string }>}
 */
export function collectStatuses(value) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    if (Array.isArray(node.status)) {
      for (const entry of node.status) {
        if (isRecord(entry) && typeof entry.status === 'string') {
          found.push(entry);
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'status') {
        walk(child);
      }
    }
  };
  walk(value);
  return found;
}

// A read-only user, or a user without the right for this command. The wording
// is not documented: matched loosely, the HTTP 403 is the other path.
const PERMISSION_MESSAGE = /denied|permission|not allowed|forbidden|read-?only|privilege/i;
const NOT_FOUND_MESSAGE = /no such|not found|unknown command|invalid command/i;

/** The first error of an answer, as a KeeneticError, or null. */
export function statusError(answer, where) {
  const error = collectStatuses(answer).find((entry) => entry.status === 'error');
  if (!error) {
    return null;
  }
  const text = String(error.message ?? '');
  const detail = [error.code, error.ident].filter(Boolean).join(' ');
  const kind = PERMISSION_MESSAGE.test(text)
    ? ERROR_KINDS.PERMISSION
    : NOT_FOUND_MESSAGE.test(text)
      ? ERROR_KINDS.NOT_FOUND
      : ERROR_KINDS.PROTOCOL;
  return new KeeneticError(
    kind,
    `${where}: ${text.slice(0, 160) || 'error'}${detail ? ` (${detail})` : ''}`,
  );
}

/** The command object of a path: ['show', 'system'] → { show: { system: {} } }. */
export function command(path, args = {}) {
  return path.reduceRight((inner, key) => ({ [key]: inner }), args);
}

/** The answer of a command, at its path in the batch answer. */
export function answerAt(entry, path) {
  let node = entry;
  for (const key of path) {
    if (!isRecord(node) || !(key in node)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

const headerOf = (headers, name) => {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

export class RciSession {
  /**
   * @param {object} options
   * @param {string} options.baseUrl e.g. http://192.0.2.1
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} [options.request] the HTTP seam (src/keenetic/http.js)
   * @param {number} [options.timeoutMs]
   */
  constructor({ baseUrl, username, password, request = httpRequest, timeoutMs = 10_000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.request = request;
    this.timeoutMs = timeoutMs;
    /** `name=value` of the session cookie (the router picks the name). */
    this.cookie = null;
    this.loggingIn = null;
    this.realm = null;
  }

  async send(method, path, json, { timeoutMs = this.timeoutMs } = {}) {
    let response;
    try {
      response = await this.request(`${this.baseUrl}${path}`, {
        method,
        json,
        timeoutMs,
        headers: this.cookie ? { cookie: this.cookie } : {},
      });
    } catch (err) {
      throw networkError(err, `${method} ${path}`);
    }
    const setCookie = response.headers?.['set-cookie'];
    for (const raw of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const pair = String(raw).split(';', 1)[0].trim();
      if (pair.includes('=')) {
        this.cookie = pair;
      }
    }
    return response;
  }

  /** Log in (concurrent callers share one attempt). */
  login() {
    this.loggingIn ??= this.authenticate().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async authenticate() {
    const probe = await this.send('GET', '/auth');
    if (probe.status === 200) {
      return; // the cookie is still a session
    }
    const realm = headerOf(probe.headers, 'x-ndm-realm');
    const challenge = headerOf(probe.headers, 'x-ndm-challenge');
    if (probe.status !== 401 || !realm || !challenge) {
      throw new KeeneticError(
        ERROR_KINDS.NOT_KEENETIC,
        `GET /auth: HTTP ${probe.status} without the Keenetic login challenge`,
      );
    }
    this.realm = realm;
    const answer = await this.send('POST', '/auth', {
      login: this.username,
      password: challengeAnswer(this.username, realm, this.password, challenge),
    });
    if (answer.status === 401 || answer.status === 403) {
      throw new KeeneticError(ERROR_KINDS.AUTH, `POST /auth: HTTP ${answer.status}`);
    }
    if (answer.status !== 200) {
      throw new KeeneticError(ERROR_KINDS.PROTOCOL, `POST /auth: HTTP ${answer.status}`);
    }
  }

  /** Close the session on the router (best effort: it expires anyway). */
  async logout() {
    if (!this.cookie) {
      return;
    }
    try {
      await this.send('DELETE', '/auth', undefined, { timeoutMs: 3000 });
    } catch {
      // the router is gone, or restarting
    }
    this.cookie = null;
  }

  /**
   * An RCI request, logged in on the first 401 and replayed once.
   * @returns {Promise<unknown>} the parsed JSON answer
   */
  async call(method, path, json, options) {
    if (!this.cookie) {
      await this.login();
    }
    let response = await this.send(method, path, json, options);
    if (response.status === 401) {
      await this.login();
      response = await this.send(method, path, json, options);
      if (response.status === 401) {
        throw new KeeneticError(ERROR_KINDS.AUTH, `${method} ${path}: HTTP 401 after a new login`);
      }
    }
    return this.parse(response, `${method} ${path}`);
  }

  parse(response, where) {
    if (response.status === 403) {
      throw new KeeneticError(ERROR_KINDS.PERMISSION, `${where}: HTTP 403`);
    }
    if (response.status === 404) {
      throw new KeeneticError(ERROR_KINDS.NOT_FOUND, `${where}: HTTP 404`);
    }
    if (response.status !== 200) {
      throw new KeeneticError(ERROR_KINDS.PROTOCOL, `${where}: HTTP ${response.status}`);
    }
    if (response.body.trim() === '') {
      return {};
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new KeeneticError(
        ERROR_KINDS.NOT_KEENETIC,
        `${where}: not JSON (${response.body.length} bytes)`,
      );
    }
  }

  /** GET /rci/<path>, an error status in the answer thrown. */
  async get(path) {
    const where = `GET /rci/${path}`;
    const answer = await this.call('GET', `/rci/${path}`);
    const error = statusError(answer, where);
    if (error) {
      throw error;
    }
    return answer;
  }

  /**
   * A batch of commands in one request. Each entry is answered on its own:
   * one command this firmware lacks does not lose the others.
   * @param {Array<{ path: string[], args?: object }>} commands
   * @param {object} [options] { timeoutMs }
   * @returns {Promise<Array<{ value?: unknown, error?: KeeneticError }>>}
   */
  async batch(commands, options) {
    const answer = await this.call(
      'POST',
      '/rci/',
      commands.map((item) => command(item.path, item.args)),
      options,
    );
    if (!Array.isArray(answer)) {
      const error = statusError(answer, 'POST /rci/');
      throw (
        error ?? new KeeneticError(ERROR_KINDS.PROTOCOL, 'POST /rci/: the answer is not an array')
      );
    }
    return commands.map((item, index) => {
      const entry = answer[index];
      const where = item.path.join(' ');
      const error = statusError(entry, where);
      if (error) {
        return { error };
      }
      const value = answerAt(entry, item.path);
      if (value === undefined) {
        return { error: new KeeneticError(ERROR_KINDS.PROTOCOL, `${where}: no answer`) };
      }
      return { value };
    });
  }
}
