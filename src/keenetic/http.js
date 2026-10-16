// -----------------------------------------------------------------------------
// The one function the Keenetic client uses to reach the network: an HTTP
// request with an optional JSON body, on node:http. The web interface of a
// Keenetic is plain HTTP on the local network (HTTPS only exists through
// KeenDNS, which does not offer the login challenge). The password never
// travels: only a SHA-256 of a one-time challenge (src/keenetic/rci.js).
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory Keenetic (test/helpers/fakeKeenetic.js).
// -----------------------------------------------------------------------------

import http from 'node:http';

// `show interface` of a router with many segments and a hotspot table of a few
// hundred hosts stay well below this.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * @param {string} url absolute http:// URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {unknown} [options.json] body, sent as JSON
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string|string[]>, body: string }>}
 */
export function httpRequest(url, { method = 'GET', headers = {}, json, timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  const payload = json === undefined ? undefined : Buffer.from(JSON.stringify(json));
  const requestHeaders = {
    accept: 'application/json',
    ...headers,
    ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
  };

  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method,
        headers: requestHeaders,
        timeout: timeoutMs,
        // Never reuse a socket across routers or credentials.
        agent: false,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload);
  });
}
