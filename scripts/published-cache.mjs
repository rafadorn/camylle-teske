// A durable copy of public content in a GitHub release, without committing images
// or old published descriptions into the source repository's history.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicDirectory, limitedBytes, verifyDirectory, readPublishedSource, MAX_SNAPSHOT_BYTES, MAX_JSON_BYTES } from './published-content.mjs';
import { MAX_IMAGE_SIZE } from '../src/project.js';
import { publicationVersion } from '../src/publication.js';
import { withProjectDefaults, validatePublicConfig } from './public-config.mjs';

const TAG = 'portfolio-published';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const assetPattern = /^snapshot-[a-f0-9]{64}-[0-9]+\.tar\.gz$/;

export function archiveEntries(archive) {
  const names = execFileSync('tar', ['-tzf', archive, '--quoting-style=literal'], { encoding: 'utf8', timeout:60000, maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
  const allowed = name => ['portfolio.json','status.json','media/'].includes(name) || /^media\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(name);
  if (names.length > 8103 || new Set(names).size !== names.length || names.some(name => !allowed(name)) || !names.includes('portfolio.json') || !names.includes('status.json')) throw new Error('Arquivo de publicação inválido.');
  const details = execFileSync('tar', ['-tvzf', archive, '--quoting-style=literal', '--numeric-owner'], { encoding: 'utf8', timeout:60000, maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
  if (details.some(line => !['-','d'].includes(line[0]))) throw new Error('Links e arquivos especiais não são permitidos na publicação.');
  let bytes = 0;
  details.forEach((line,index) => {
    const size = Number(line.trim().split(/\s+/)[2]);
    bytes += size;
    if (!Number.isSafeInteger(size) || size < 0 || size > (names[index].endsWith('.json') ? MAX_JSON_BYTES : MAX_IMAGE_SIZE) || bytes > MAX_SNAPSHOT_BYTES) throw new Error('Arquivo de publicação acima do limite.');
  });
  return names;
}

export async function unpackSnapshot(archive, directory) {
  archiveEntries(archive);
  const workspace = await mkdtemp(join(tmpdir(), 'camy-published-restore-'));
  const staged = join(workspace, 'published');
  try {
    await mkdir(staged);
    execFileSync('tar', ['-xzf', archive, '-C', staged, '--no-same-owner', '--no-same-permissions'], { timeout:60000 });
    await verifyDirectory(staged);
    await atomicDirectory(staged, directory);
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

function github({ repository = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, fetcher = fetch } = {}) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '') || !token) throw new Error('Configure a publicação no GitHub Actions.');
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path, method = 'GET', body, missing = false) {
    const response = await fetcher(base + path, { method, redirect: 'error', signal: AbortSignal.timeout(45000), headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub publication HTTP ${response.status}.`);
    return response.status === 204 ? null : response.json();
  }
  return { base, repository, token, fetcher, request };
}

function pointer(release) {
  const value = JSON.parse(release.body || '{}');
  if (value.schema !== 1 || !assetPattern.test(value.asset_name) || !/^[a-f0-9]{64}$/.test(value.source_version) || !value.asset_name.startsWith('snapshot-'+value.source_version+'-') || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_SNAPSHOT_BYTES) throw new Error('Cópia publicada indisponível.');
  return value;
}

export async function publicationNeeded({ eventName, url, key, ...options }) {
  if (eventName !== 'schedule') return true;
  const api = github(options);
  const release = await api.request(`/releases/tags/${TAG}`, 'GET', null, true);
  if (!release) return true;
  let state;
  try { state = pointer(release); } catch { return true; }
  try {
    const source = await readPublishedSource({ url, key, fetcher: options.fetcher || fetch });
    return await publicationVersion(source) !== state.source_version;
  } catch { return false; } // Keep the last publication when the source is down.
}

export async function restoreCache(directory, options) {
  const api = github(options);
  const release = await api.request(`/releases/tags/${TAG}`, 'GET', null, true);
  if (!release) return false;
  const state = pointer(release);
  const asset = release.assets.find(asset => asset.name === state.asset_name && asset.state === 'uploaded');
  if (!asset || asset.size !== state.bytes || !asset.browser_download_url?.startsWith(`https://github.com/${api.repository}/releases/download/${TAG}/`)) throw new Error('Cópia publicada incompleta.');
  // The release is public. Never send a GitHub token to the asset CDN.
  const bytes = await limitedBytes(await api.fetcher(asset.browser_download_url, { signal: AbortSignal.timeout(120000), credentials: 'omit' }), MAX_SNAPSHOT_BYTES);
  if (bytes.length !== state.bytes || digest(bytes) !== state.sha256) throw new Error('A cópia publicada não passou na verificação.');
  const workspace = await mkdtemp(join(tmpdir(), 'camy-published-download-'));
  try {
    const archive = join(workspace, 'snapshot.tar.gz');
    await writeFile(archive, bytes);
    await unpackSnapshot(archive, directory);
  } finally { await rm(workspace, { recursive: true, force: true }); }
  return true;
}

export async function saveCache(directory, options) {
  const api = github(options);
  const snapshot = await verifyDirectory(directory);
  let release = await api.request(`/releases/tags/${TAG}`, 'GET', null, true);
  if (release) {
    try {
      const state = pointer(release);
      if (state.source_version === snapshot.source_version && release.assets.some(asset => asset.name === state.asset_name && asset.state === 'uploaded')) return false;
    } catch { /* Retry an interrupted first publication. */ }
  } else {
    release = await api.request('/releases', 'POST', { tag_name: TAG, target_commitish: process.env.GITHUB_SHA || 'main', name: 'Conteúdo público do portfólio', body: '{}', prerelease: true, make_latest: 'false' });
  }
  const workspace = await mkdtemp(join(tmpdir(), 'camy-published-archive-'));
  try {
    const archive = join(workspace, 'snapshot.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', directory, 'portfolio.json', 'status.json', 'media']);
    archiveEntries(archive);
    if ((await stat(archive)).size > MAX_SNAPSHOT_BYTES) throw new Error('Cópia publicada acima do limite.');
    const bytes = await readFile(archive);
    const name = `snapshot-${snapshot.source_version}-${Date.now()}.tar.gz`;
    const upload = new URL(release.upload_url.replace(/\{.*$/, ''));
    if (upload.origin !== 'https://uploads.github.com' || !upload.pathname.startsWith(`/repos/${api.repository}/releases/`)) throw new Error('Destino de publicação inválido.');
    upload.searchParams.set('name', name);
    const result = await api.fetcher(upload, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { authorization: 'Bearer ' + api.token, 'content-type': 'application/gzip', 'content-length': String(bytes.length), 'x-github-api-version': '2022-11-28' }, body: bytes });
    if (!result.ok) throw new Error(`GitHub archive upload HTTP ${result.status}.`);
    // Switch the pointer only after the complete archive was uploaded.
    await api.request(`/releases/${release.id}`, 'PATCH', { body: JSON.stringify({ schema: 1, source_version: snapshot.source_version, asset_name: name, bytes: bytes.length, sha256: digest(bytes) }) });
    return true;
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

export async function cleanCache(options) {
  const api = github(options);
  const release = await api.request(`/releases/tags/${TAG}`);
  const state = pointer(release);
  for (const asset of release.assets) {
    if (assetPattern.test(asset.name) && asset.name !== state.asset_name) await api.request(`/releases/assets/${asset.id}`, 'DELETE');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2], directory = resolve('public/published');
  try {
    if (command === 'probe') {
      const config = withProjectDefaults(process.env); validatePublicConfig(config);
      const needed = await publicationNeeded({ eventName: process.env.GITHUB_EVENT_NAME, url: config.VITE_SUPABASE_URL, key: config.VITE_SUPABASE_PUBLISHABLE_KEY });
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${needed}\n`);
      console.log(needed ? 'A publication is needed.' : 'Public content unchanged or source unavailable; current site preserved.');
    } else if (command === 'restore') {
      // A remote export can repair a missing cache. Refresh still fails closed
      // when neither a cache nor an authoritative source is available.
      try { console.log(await restoreCache(directory) ? 'Verified published copy restored.' : 'First public export.'); }
      catch { console.warn('::warning::Não foi possível restaurar a cópia. Uma exportação completa do Supabase será necessária.'); }
    } else if (command === 'save') console.log(await saveCache(directory) ? 'Verified public copy stored in GitHub.' : 'Public copy unchanged.');
    else if (command === 'clean') { await cleanCache(); console.log('Previous public archives removed.'); }
    else throw new Error('Comando inválido.');
  } catch {
    console.error('Não foi possível concluir a cópia pública no GitHub. Nenhuma credencial foi registrada.');
    process.exitCode = 1;
  }
}
