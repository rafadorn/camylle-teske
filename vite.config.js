import { defineConfig, loadEnv } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePublicConfig, withProjectDefaults } from './scripts/public-config.mjs';

function htmlFiles(dir = '.', files = []) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'public'].includes(item.name)) continue;
    const path = resolve(dir, item.name);
    if (item.isDirectory()) htmlFiles(path, files);
    else if (item.name.endsWith('.html')) files.push(path);
  }
  return files;
}

export default defineConfig(({ mode }) => {
  const env = withProjectDefaults(loadEnv(mode, process.cwd(), ''));
  validatePublicConfig(env);
  return {
    base: env.VITE_BASE_PATH || '/',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY),
    },
    build: { rollupOptions: { input: htmlFiles() } },
  };
});
