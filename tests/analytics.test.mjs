import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsPath, analyticsURL, brazilDay, summarizeViews } from '../src/analytics-path.js';
import { createHandler, publicKeys, backendKey } from '../supabase/functions/record-portfolio-view/handler.mjs';

test('only canonical public paths enter statistics; no queries, identities or admin pages', () => {
  for (const path of ['/', '/projetos/', '/sobre/', '/contato/', '/privacidade/', '/projetos/projeto-publico/']) assert.equal(analyticsPath(path), path);
  for (const path of ['/admin/', '/projeto/?trabalho=abc', '/sobre/?email=private', '/#token', 'https://evil.test', '/projetos/../admin/', '/projetos/ABC/', null]) assert.equal(analyticsPath(path), null);
});
test('days and totals use Brazil time and page views rather than unique people', () => {
  assert.equal(brazilDay(new Date('2026-11-10T01:30:00Z')), '2026-11-09');
  const rows = [{ view_day: '2026-11-09', page_path: '/', views: 2 }, { view_day: '2026-11-08', page_path: '/', views: 3 }, { view_day: '2026-10-20', page_path: '/sobre/', views: 4 }, { view_day: '2026-11-09', page_path: '/admin/', views: 99 }];
  const stats = summarizeViews(rows, 7, '2026-11-09');
  assert.deepEqual([stats.today, stats.week, stats.month, stats.total], [2, 5, 9, 5]);
  assert.equal(stats.days.length, 7); assert.equal(stats.pages[0].path, '/');
});
test('report links open dynamically published projects, including on a project Pages base path', () => {
  assert.equal(analyticsURL('/projetos/new-work/', '/'), '/projeto/?trabalho=new-work');
  assert.equal(analyticsURL('/projetos/new-work/', '/camylle-teske/'), '/camylle-teske/projeto/?trabalho=new-work');
  assert.equal(analyticsURL('/sobre/', '/'), '/sobre/');
  assert.equal(analyticsURL('/projetos/', '/camylle-teske/'), '/camylle-teske/projetos/');
  assert.equal(analyticsURL('https://evil.test/', '/'), '/');
});
const projectURL = 'https://fixture.supabase.co';
function request(body, { origin = 'https://camylle-teske.com.br', key = 'test-public', method = 'POST', type = 'application/json' } = {}) {
  return new Request('https://fixture.supabase.co/functions/v1/record-portfolio-view', { method, headers: { origin, apikey: key, 'content-type': type, Authorization: 'Bearer private-user-session', Cookie: 'private=ignored', 'x-forwarded-for': '192.0.2.1' }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
test('collector sends only the canonical path to its privileged RPC and never forwards visitor headers', async () => {
  let call;
  const handler = createHandler({ projectURL, keys: ['test-public'], serviceKey: 'sb_secret_server_test', fetcher: async (url, options) => { call = { url, options }; return Response.json(true); } });
  assert.equal((await handler(request({ path: '/projetos/', consent: 'statistics-v1' }))).status, 204);
  const response = await handler(request({ path: '/sobre/', consent: 'statistics-v1' }));
  assert.equal(response.status, 204); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://camylle-teske.com.br');
  assert.deepEqual(JSON.parse(call.options.body), { page_path: '/sobre/' });
  assert.deepEqual(call.options.headers, { apikey: 'sb_secret_server_test', 'content-type': 'application/json' });
  assert.ok(!JSON.stringify(call).includes('private-user-session') && !JSON.stringify(call).includes('192.0.2.1'));
});
test('collector rejects no consent, extra fields, tracking query strings, bad origin, bad keys, methods and oversized bodies', async () => {
  let writes = 0;
  const handler = createHandler({ projectURL, keys: ['test-public'], serviceKey: 'test-service', fetcher: async () => { writes++; return Response.json(true); } });
  for (const body of [{ path: '/' }, { path: '/', consent: 'refused' }, { path: '/?email=private', consent: 'statistics-v1' }, { path: '/admin/', consent: 'statistics-v1' }, { path: '/', consent: 'statistics-v1', id: 'visitor-id' }, 'x'.repeat(600)]) assert.equal((await handler(request(body))).status, 400);
  assert.equal((await handler(request({}, { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handler(request({}, { key: 'sb_secret_attacker' }))).status, 401);
  assert.equal((await handler(request({}, { method: 'GET' }))).status, 405);
  assert.equal((await handler(request({}, { type: 'text/plain' }))).status, 415);
  assert.equal(writes, 0);
  assert.equal((await handler(request({}, { method: 'OPTIONS' }))).status, 204);
});
test('collector handles public key rotation, capped writes and backend errors without leaking details', async () => {
  let requests = 0;
  const handler = createHandler({ projectURL, keys: [], serviceKey: 'test-server', fetcher: async (_, options) => { requests++; return options.method === 'HEAD' ? new Response(null, { status: 200 }) : Response.json(false); } });
  assert.equal((await handler(request({ path: '/', consent: 'statistics-v1' }, { key: 'sb_publishable_rotated' }))).status, 429);
  assert.equal(requests, 2);
  const failed = createHandler({ projectURL, keys: ['test-public'], serviceKey: 'test-server', fetcher: async () => { throw new Error('private database details'); } });
  const response = await failed(request({ path: '/', consent: 'statistics-v1' }));
  assert.equal(response.status, 503); assert.equal(await response.text(), '');
});
test('authenticated deployment probe validates the RPC without creating a page view', async () => {
  let payload;
  const handler = createHandler({ projectURL, keys: ['test-public'], serviceKey: 'test-server', fetcher: async (_, options) => { payload = JSON.parse(options.body); return Response.json(true); } });
  assert.equal((await handler(request(null, { method: 'HEAD' }))).status, 204);
  assert.deepEqual(payload, { page_path: null });
});
test('function keys come from platform env and support both modern and legacy configurations', () => {
  const env = name => ({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"public"}', SUPABASE_SECRET_KEYS: '{"default":"server"}', SUPABASE_ANON_KEY: 'legacy-public' }[name]);
  assert.deepEqual(publicKeys(env), ['public', 'legacy-public']); assert.equal(backendKey(env), 'server');
});
