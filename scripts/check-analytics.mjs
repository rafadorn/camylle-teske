// Live deployment check. HEAD validates the collector and its RPC without
// creating a page view; invalid consent must never reach the counter.
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { withProjectDefaults, validatePublicConfig } from './public-config.mjs';
const config = withProjectDefaults(loadEnv('production', process.cwd(), ''));
validatePublicConfig(config);
const url = config.VITE_SUPABASE_URL;
const headers = { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY, Origin: 'https://camylle-teske.com.br', 'content-type': 'application/json' };
async function check(path, options, allowed) {
  const response = await fetch(url + path, { headers, signal: AbortSignal.timeout(15000), ...options });
  assert.ok(allowed.includes(response.status), `Analytics deployment check failed: ${path}, HTTP ${response.status}`);
}
await check('/functions/v1/record-portfolio-view', { method: 'HEAD' }, [204]);
await check('/functions/v1/record-portfolio-view', { method: 'POST', body: JSON.stringify({ path: '/', consent: 'refused' }) }, [400]);
await check('/rest/v1/rpc/record_portfolio_page_view', { method: 'POST', body: JSON.stringify({ page_path: '/' }) }, [401, 403, 404]);
await check('/rest/v1/rpc/portfolio_analytics', { method: 'POST', body: JSON.stringify({ days: 30 }) }, [401, 403, 404]);
console.log('Analytics backend OK: collector/RPC available; refusal rejected; anonymous writes and private reports blocked. No page views created.');
