import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rename, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { publishedRecords, publicationVersion, makeSnapshot, validateSnapshot, snapshotStatus, MAX_PUBLISHED_PROJECTS } from '../src/publication.js';
import { MAX_IMAGE_SIZE } from '../src/project.js';

export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function limitedBytes(response, limit) {
  if (!response.ok) { const error = new Error(`Resposta de publicação HTTP ${response.status}.`); error.httpStatus = response.status; throw error; }
  if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('Arquivo público acima do limite.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) { await response.body.cancel().catch(() => {}); throw new Error('Arquivo público acima do limite.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function imageExtension(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'webp';
  throw new Error('A publicação aceita apenas imagens JPG, PNG e WebP.');
}

export async function verifyDirectory(directory) {
  const json = await readFile(join(directory, 'portfolio.json'));
  if (json.length > MAX_JSON_BYTES) throw new Error('Publicação acima do limite.');
  const snapshot = validateSnapshot(JSON.parse(json));
  const expected = new Set(snapshot.projects.flatMap(project => project.media.map(media => media.local.replace('published/', ''))));
  let bytes = json.length;
  for (const name of expected) {
    const file = await readFile(join(directory, name));
    bytes += file.length;
    if (file.length > MAX_IMAGE_SIZE || bytes > MAX_SNAPSHOT_BYTES || name !== `media/${hash(file)}.${imageExtension(file)}`) throw new Error('Arquivo da publicação inválido.');
  }
  const status = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'));
  if (JSON.stringify(status) !== JSON.stringify(snapshotStatus(snapshot))) throw new Error('Estado de publicação inconsistente.');
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some(entry => !['portfolio.json','status.json','media'].includes(entry.name) || entry.isSymbolicLink())) throw new Error('Arquivo inesperado na publicação.');
  const mediaFiles = await readdir(join(directory, 'media'), { withFileTypes: true });
  if (mediaFiles.length !== expected.size || mediaFiles.some(entry => !entry.isFile() || !expected.has('media/' + entry.name))) throw new Error('Imagens não referenciadas na publicação.');
  return snapshot;
}

export async function atomicDirectory(staged, directory) {
  const backup = directory + '.previous';
  await mkdir(dirname(directory), { recursive: true });
  await rm(backup, { recursive: true, force: true });
  let previous = false;
  try { await rename(directory, backup); previous = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(staged, directory); } catch (error) { if (previous) await rename(backup, directory); throw error; }
  await rm(backup, { recursive: true, force: true });
}

function publicRequest(url, key, fetcher) {
  const api = new URL(url);
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.pathname !== '/') throw new Error('Endereço do projeto inválido.');
  const headers = { apikey: key, ...(key.startsWith('sb_publishable_') ? {} : { Authorization: 'Bearer ' + key }) };
  return (path, options = {}) => fetcher(new URL(path, api), { redirect: 'error', signal: AbortSignal.timeout(45000), ...options, headers: { ...headers, ...options.headers } });
}

export async function readPublishedSource({ url, key, fetcher = fetch }) {
  const request = publicRequest(url, key, fetcher);
  const params = new URLSearchParams({ select: 'slug,title,category,description,position,status,cover_layout,cover_path,card_layout,media', status: 'eq.published', order: 'position.asc,slug.asc', limit: String(MAX_PUBLISHED_PROJECTS + 1) });
  const bytes = await limitedBytes(await request('/rest/v1/projects?' + params), MAX_JSON_BYTES);
  const data = JSON.parse(bytes.toString());
  if (!Array.isArray(data) || data.length > MAX_PUBLISHED_PROJECTS || data.some(project => project.status !== 'published')) throw new Error('Resposta pública inválida.');
  return publishedRecords(data);
}

export async function exportPublished({ url, key, directory, fetcher = fetch, publishedAt, onSummary = () => {}, onStage = () => {} }) {
  const api = new URL(url);
  const request = publicRequest(url, key, fetcher);
  const records = () => readPublishedSource({ url, key, fetcher });
  onStage('projects');
  const projects = await records();
  const version = await publicationVersion(projects);
  let existing;
  try { existing = await verifyDirectory(directory); } catch { /* A first export has no local publication. */ }
  if (existing?.source_version === version) return { snapshot: existing, changed: false, backendAvailable: true };
  const workspace = await mkdtemp(join(tmpdir(), 'camy-publication-'));
  const staged = join(workspace, 'published');
  await mkdir(join(staged, 'media'), { recursive: true });
  try {
    const paths = [...new Set(projects.flatMap(project => project.media.map(media => media.path)))];
    const signed = new Map();
    onStage('signing');
    for (let i = 0; i < paths.length; i += 100) {
      const requested = paths.slice(i, i + 100);
      const bytes = await limitedBytes(await request('/storage/v1/object/sign/portfolio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: requested, expiresIn: 300 }) }), MAX_JSON_BYTES);
      const result = JSON.parse(bytes.toString());
      if (!Array.isArray(result) || result.length !== requested.length) throw new Error('Não foi possível preparar as imagens públicas.');
      for (const item of result) {
        if (!requested.includes(item.path) || signed.has(item.path) || item.error || !item.signedURL) throw new Error('Imagem pública indisponível.');
        const address = new URL(item.signedURL.startsWith('/object/') ? '/storage/v1' + item.signedURL : item.signedURL, api);
        if (address.origin !== api.origin || !address.pathname.startsWith('/storage/v1/object/sign/portfolio/')) throw new Error('Endereço de imagem inválido.');
        signed.set(item.path, address);
      }
    }
    let totalBytes = 0;
    const localPaths = new Map();
    onStage('images');
    // Download one at a time: memory stays bounded by one permitted image.
    for (const path of paths) {
      const response = await fetcher(signed.get(path), { redirect: 'error', signal: AbortSignal.timeout(60000), credentials: 'omit' });
      const bytes = await limitedBytes(response, MAX_IMAGE_SIZE);
      totalBytes += bytes.length;
      if (totalBytes > MAX_SNAPSHOT_BYTES - MAX_JSON_BYTES) throw new Error('As imagens excedem o limite da publicação.');
      const filename = `${hash(bytes)}.${imageExtension(bytes)}`;
      await writeFile(join(staged, 'media', filename), bytes);
      localPaths.set(path, 'published/media/' + filename);
    }
    // A project removed while files were downloading must not enter the new site.
    onStage('consistency');
    if (await publicationVersion(await records()) !== version) throw new Error('O portfólio mudou durante a publicação. Tente novamente.');
    onStage('snapshot');
    const snapshot = await makeSnapshot(projects, localPaths, publishedAt);
    await writeFile(join(staged, 'portfolio.json'), JSON.stringify(snapshot));
    await writeFile(join(staged, 'status.json'), JSON.stringify(snapshotStatus(snapshot)));
    await verifyDirectory(staged);
    await atomicDirectory(staged, directory);
    onSummary({ projects: projects.length, images: paths.length, bytes: totalBytes });
    return { snapshot, changed: true, backendAvailable: true };
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

export async function refreshPublished(options) {
  let stage = 'projects';
  try { return await exportPublished({ ...options, onStage: value => { stage = value; options.onStage?.(value); } }); }
  catch (error) {
    // An unavailable backend can never turn a previous publication into an empty site.
    try {
      const snapshot = await verifyDirectory(options.directory);
      return { snapshot, changed: false, backendAvailable: false, failedStage: stage };
    } catch {
      const failure = new Error('Nenhuma publicação completa disponível.');
      failure.publicationStage = stage;
      failure.httpStatus = error.httpStatus;
      throw failure;
    }
  }
}
