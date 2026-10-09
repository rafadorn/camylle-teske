import { readFileSync } from 'node:fs';

const projectConfig = JSON.parse(readFileSync(new URL('../supabase/public-config.json', import.meta.url), 'utf8'));

// Somente valores públicos. Uma configuração de ambiente substitui o par inteiro.
export function withProjectDefaults(env) {
  if (env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY) return env;
  return { ...env, VITE_SUPABASE_URL: projectConfig.url, VITE_SUPABASE_PUBLISHABLE_KEY: projectConfig.publishableKey };
}

export function validatePublicConfig(env) {
  const url = env.VITE_SUPABASE_URL || '', key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (Boolean(url) !== Boolean(key)) throw new Error('Configure a URL do Supabase e a chave publicável juntas.');
  if (!url) return false;
  if (!url.startsWith('https://')) throw new Error('Use a URL HTTPS do seu projeto Supabase.');
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) throw new Error('Chaves secretas não podem ser incluídas no site.');
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (payload.role === 'anon') return true;
  } catch { /* Rejeita chaves desconhecidas. */ }
  throw new Error('Use somente a chave publicável ou anon. A chave service_role não pode ser incluída no site.');
}
