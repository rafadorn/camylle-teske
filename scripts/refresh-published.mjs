import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { withProjectDefaults, validatePublicConfig } from './public-config.mjs';
import { refreshPublished } from './published-content.mjs';

const env = withProjectDefaults(loadEnv('production', process.cwd(), ''));
validatePublicConfig(env);
try {
  const result = await refreshPublished({ url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY, directory: resolve('public/published'), onSummary: summary => console.log('Public export:', JSON.stringify(summary)) });
  if (!result.backendAvailable) console.warn('::warning::Supabase indisponível para exportação. Preservada a última publicação completa.');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `backend_available=${result.backendAvailable}\ncontent_changed=${result.changed}\n`);
  console.log(`Published portfolio ready: ${result.snapshot.projects.length} projects. No drafts or signed URLs included.`);
} catch (error) {
  console.error(`Export stage: ${error.publicationStage || 'configuration'}${error.httpStatus ? ', HTTP ' + error.httpStatus : ''}.`);
  console.error('Não há uma publicação completa disponível. A publicação foi interrompida para preservar o site atual.');
  process.exitCode = 1;
}
