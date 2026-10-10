import test from 'node:test';
import assert from 'node:assert/strict';
import { authOptionsForLocation, secureAuthLocation, httpsLocation, createAuthBoundary, sessionExpired } from '../src/security.js';

const session = id => ({ user: { id }, access_token: 'token' });

test('public HTTP never restores credentials, including hosts that imitate localhost', () => {
  for (const origin of ['http://camylle-teske.com.br', 'http://localhost.example.com', 'http://127.0.0.1.example.com', 'http://192.168.1.20']) {
    const location = new URL(origin);
    assert.equal(secureAuthLocation(location), false);
    assert.deepEqual(authOptionsForLocation(location), { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  }
  for (const origin of ['https://camylle-teske.com.br', 'http://localhost:5173', 'http://127.0.0.1:4179', 'http://[::1]:5173']) {
    assert.equal(secureAuthLocation(new URL(origin)), true);
    assert.equal(authOptionsForLocation(new URL(origin)).detectSessionInUrl, true);
  }
  assert.equal(secureAuthLocation(new URL('file:///admin/index.html')), false);
});

test('HTTPS handoff preserves the recovery link, deployment path and token fragment', () => {
  const original = new URL('http://www.camylle-teske.com.br/camylle-teske/admin/?senha=alterar&code=a%2Bb#access_token=a%2Fb&refresh_token=c%2Bd&type=recovery');
  const target = new URL(httpsLocation(original));
  assert.equal(target.protocol, 'https:');
  assert.equal(target.host, original.host);
  assert.equal(target.pathname, original.pathname);
  assert.equal(target.search, original.search);
  assert.equal(target.hash, original.hash);
  assert.equal(httpsLocation(new URL('https://camylle-teske.com.br/admin/')), null);
  assert.equal(httpsLocation(new URL('http://127.0.0.1:4179/admin/')), null);
});

test('logout invalidates an in-flight result even when the same account logs in again', async () => {
  const boundary = createAuthBoundary();
  boundary.observe('SIGNED_IN', session('camy'));
  const ticket = boundary.capture();
  let complete;
  const response = new Promise(resolve => { complete = resolve; });
  let privateResultRendered = false;
  const pending = response.then(() => { if (boundary.current(ticket)) privateResultRendered = true; });
  assert.equal(boundary.observe('SIGNED_OUT', null), 'login');
  boundary.observe('SIGNED_IN', session('camy'));
  complete(); await pending;
  assert.equal(privateResultRendered, false);
  assert.equal(boundary.current(ticket), false);
});

test('refresh and repeated same-account sign-in preserve valid editor work', () => {
  const boundary = createAuthBoundary();
  boundary.observe('INITIAL_SESSION', session('camy'));
  const ticket = boundary.capture();
  for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED']) {
    assert.equal(boundary.observe(event, { ...session('camy'), access_token: 'renewed' }), 'keep');
    assert.equal(boundary.current(ticket), true);
  }
  assert.equal(boundary.observe('SIGNED_IN', session('other-account')), 'enter');
  assert.equal(boundary.current(ticket), false);
});

test('recovery and a removed session invalidate work from the previous screen', () => {
  const boundary = createAuthBoundary();
  boundary.observe('SIGNED_IN', session('camy'));
  const editorTicket = boundary.capture();
  assert.equal(boundary.observe('PASSWORD_RECOVERY', session('camy')), 'recovery');
  assert.equal(boundary.current(editorTicket), false);
  const recoveryTicket = boundary.capture();
  assert.equal(boundary.observe('TOKEN_REFRESHED', null), 'login');
  assert.equal(boundary.current(recoveryTicket), false);
  assert.equal(boundary.userId, null);
});

test('temporary failures preserve editing, while rejected credentials require a new session', () => {
  for (const error of [new TypeError('Failed to fetch'), { status: 503, message: 'offline' }, { code: '42501', message: 'permission denied' }]) {
    assert.equal(sessionExpired(error), false);
  }
  for (const error of [{ status: 401 }, { code: 'PGRST301' }, { code: 'refresh_token_not_found' }, { name: 'AuthSessionMissingError' }, { message: 'JWT expired' }]) {
    assert.equal(sessionExpired(error), true);
  }
});
