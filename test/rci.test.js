// -----------------------------------------------------------------------------
// The RCI session (src/keenetic/rci.js): the challenge of the web interface,
// the session cookie, the second login after an expiry, the batches and the
// error statuses inside an HTTP 200.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RciSession,
  answerAt,
  challengeAnswer,
  collectStatuses,
  command,
  statusError,
} from '../src/keenetic/rci.js';
import { ERROR_KINDS } from '../src/keenetic/errors.js';
import { FakeKeenetic, createNetwork } from './helpers/fakeKeenetic.js';

const open = (router, { username = 'gladys', password = 'secret', host = '192.0.2.1' } = {}) => {
  const network = createNetwork({ '192.0.2.1': router });
  return new RciSession({
    baseUrl: `http://${host}`,
    username,
    password,
    request: network.request,
  });
};

test('the answer to the challenge is sha256(challenge + md5(login:realm:password))', () => {
  // Computed independently (Python hashlib) for this triple.
  assert.equal(
    challengeAnswer('admin', 'Keenetic Giga', 'correct horse', '0123456789ABCDEF'),
    'ca3fac794edcf10cb368f08c0a9787d18eec9b36b08cbecd7df5641342954081',
  );
});

test('login: the challenge, then the cookie becomes a session', async () => {
  const router = new FakeKeenetic();
  const session = open(router);
  await session.login();
  assert.equal(router.logins.ok, 1);
  assert.match(session.cookie, /^[A-Z]{8}=[0-9a-f]+$/);
  const system = await session.get('show/system');
  assert.equal(system.cpuload, 7);
  assert.equal(router.logins.ok, 1, 'no second login while the session lives');
});

test('a wrong password is an auth error, and the password is in no message', async () => {
  const router = new FakeKeenetic();
  const session = open(router, { password: 'wrong-password-42' });
  await assert.rejects(session.login(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.ok(!err.message.includes('wrong-password-42'));
    return true;
  });
  assert.equal(router.logins.failed, 1);
});

test('an expired session logs in again once, then replays the request', async () => {
  const router = new FakeKeenetic();
  const session = open(router);
  await session.login();
  router.expireSessions();
  const system = await session.get('show/system');
  assert.equal(system.uptime, '345612');
  assert.equal(router.logins.ok, 2);
});

test('something that is not a Keenetic, or nothing at all', async () => {
  const notKeenetic = {
    request: async () => ({ status: 404, headers: {}, body: '<html></html>' }),
  };
  const session = new RciSession({
    baseUrl: 'http://192.0.2.1',
    username: 'gladys',
    password: 'secret',
    request: notKeenetic.request,
  });
  await assert.rejects(session.login(), { kind: ERROR_KINDS.NOT_KEENETIC });

  // A 401 without the challenge headers (KeenDNS, another device).
  const plain401 = { request: async () => ({ status: 401, headers: {}, body: '' }) };
  const other = new RciSession({ baseUrl: 'http://192.0.2.1', ...plain401, username: 'a' });
  await assert.rejects(other.login(), { kind: ERROR_KINDS.NOT_KEENETIC });

  const nobody = open(new FakeKeenetic(), { host: '192.0.2.200' });
  await assert.rejects(nobody.login(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('a batch answers each command on its own', async () => {
  const router = new FakeKeenetic({ identification: false });
  const session = open(router);
  const [system, identification, stat] = await session.batch([
    { path: ['show', 'system'] },
    { path: ['show', 'identification'] },
    { path: ['show', 'interface', 'stat'], args: { name: 'PPPoE0' } },
  ]);
  assert.equal(system.value.hostname, 'Keenetic-0042');
  assert.equal(identification.error.kind, ERROR_KINDS.NOT_FOUND);
  assert.equal(stat.value.rxbytes, 6543210987);
});

test('an error status inside an HTTP 200 is an error, a read-only refusal a permission one', () => {
  assert.equal(statusError({ show: { system: { cpuload: 1 } } }, 'x'), null);
  const denied = statusError(
    {
      interface: {
        status: [{ status: 'error', code: '7405600', message: 'access denied: read-only user' }],
      },
    },
    'interface',
  );
  assert.equal(denied.kind, ERROR_KINDS.PERMISSION);
  const other = statusError({ status: [{ status: 'error', message: 'invalid argument' }] }, 'x');
  assert.equal(other.kind, ERROR_KINDS.PROTOCOL);
  assert.deepEqual(
    collectStatuses([{ a: { status: [{ status: 'message', message: 'ok' }] } }]).map(
      (s) => s.status,
    ),
    ['message'],
  );
});

test('commands are nested objects, answers are read at the same path', () => {
  assert.deepEqual(command(['show', 'interface', 'stat'], { name: 'PPPoE0' }), {
    show: { interface: { stat: { name: 'PPPoE0' } } },
  });
  assert.deepEqual(answerAt({ show: { system: { a: 1 } } }, ['show', 'system']), { a: 1 });
  assert.equal(answerAt({ show: {} }, ['show', 'system']), undefined);
});

test('logout closes the session on the router', async () => {
  const router = new FakeKeenetic();
  const session = open(router);
  await session.login();
  assert.equal(router.sessions.length, 1);
  await session.logout();
  assert.equal(router.sessions.length, 0);
});
