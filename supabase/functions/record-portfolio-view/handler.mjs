const ORIGINS = new Set(['https://camylle-teske.com.br', 'https://www.camylle-teske.com.br', 'https://rafadorn.github.io']);
const validPath = path => typeof path === 'string' && path.length <= 180 && (
  ['/', '/projetos/', '/sobre/', '/contato/', '/privacidade/'].includes(path) || /^\/projetos\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(path));

async function readPayload(request) {
  if (!request.body || Number(request.headers.get('content-length')) > 512) throw new Error('payload');
  const reader = request.body.getReader(); let bytes = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 512) { await reader.cancel(); throw new Error('payload'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}

export function publicKeys(env) {
  let modern = [];
  try { modern = Object.values(JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}')).filter(v => typeof v === 'string'); } catch { /* Legacy environments can lack this JSON map. */ }
  return [...modern, env('SUPABASE_ANON_KEY')].filter(Boolean);
}

export function backendKey(env) {
  try { const value = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default; if (value) return value; } catch { /* Use the platform-provided legacy key. */ }
  return env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

export function createHandler({ projectURL, keys, serviceKey, fetcher = fetch }) {
  const knownKeys = new Set(keys);
  return async request => {
    const origin = request.headers.get('origin');
    if (!ORIGINS.has(origin)) return new Response(null, { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const reply = status => new Response(null, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'apikey, content-type', 'Access-Control-Max-Age': '600' } });
    if (!['POST', 'HEAD'].includes(request.method)) return reply(405);
    if (request.method === 'POST' && !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(415);
    const key = request.headers.get('apikey') || '';
    if (!key || key.length > 1000 || (!knownKeys.has(key) && !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key))) return reply(401);
    if (!projectURL || !serviceKey) return reply(503);
    try {
      // Validate rotated publishable keys if an older runtime omits its key map.
      // No user token, cookie, IP, user agent or referrer is forwarded.
      if (!knownKeys.has(key)) {
        const checked = await fetcher(`${projectURL}/rest/v1/projects?select=slug&limit=0`, { method: 'HEAD', headers: { apikey: key }, signal: AbortSignal.timeout(3000) });
        if (!checked.ok) return reply(401);
      }
      let path = null;
      if (request.method === 'POST') {
        let body;
        try { body = await readPayload(request); } catch { return reply(400); }
        if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'consent,path' || body.consent !== 'statistics-v1' || !validPath(body.path)) return reply(400);
        path = body.path;
      }
      const auth = { apikey: serviceKey, 'content-type': 'application/json' };
      if (!serviceKey.startsWith('sb_secret_')) auth.Authorization = `Bearer ${serviceKey}`;
      const response = await fetcher(`${projectURL}/rest/v1/rpc/record_portfolio_page_view`, {
        method: 'POST', headers: auth, body: JSON.stringify({ page_path: path }), signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return reply(503);
      return reply(await response.json() === true ? 204 : 429);
    } catch { return reply(503); }
  };
}
