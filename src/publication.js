import { recordForSave, validateProject } from './project.js';

export const SNAPSHOT_SCHEMA = 1;
export const SNAPSHOT_FILE = 'published/portfolio.json';
export const STATUS_FILE = 'published/status.json';
export const MAX_PUBLISHED_PROJECTS = 200;
export const publicImagePath = /^published\/media\/[a-f0-9]{64}\.(jpg|png|webp)$/;

function text(value, limit) {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Texto público inválido.');
  return value;
}

// A positive list: sessions, signed URLs, drafts and extra database columns never enter an export.
export function publishedRecords(projects) {
  if (!Array.isArray(projects)) throw new Error('Lista pública inválida.');
  const rows = projects.filter(project => project?.status === 'published');
  if (rows.length > MAX_PUBLISHED_PROJECTS) throw new Error('Limite de trabalhos publicados excedido.');
  const slugs = new Set();
  return [...rows].sort((a, b) => a.position - b.position || String(a.slug).localeCompare(String(b.slug))).map(project => {
    for (const [field, limit] of [['title',160],['category',160],['description',12000],['slug',100]]) text(project[field], limit);
    if (slugs.has(project.slug)) throw new Error('Endereço público duplicado.');
    slugs.add(project.slug);
    if (!Array.isArray(project.media)) throw new Error('Imagens públicas inválidas.');
    for (const media of project.media) {
      if (typeof media.path !== 'string' || media.path.length > 512 || !/^[a-zA-Z0-9_./-]+$/.test(media.path) || media.path.startsWith('/') || media.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Caminho de imagem inválido.');
      text(media.alt || '', 600);
    }
    const { id, ...record } = recordForSave(project);
    validateProject(record);
    return record;
  });
}

export async function publicationVersion(projects) {
  const bytes = new TextEncoder().encode(JSON.stringify(publishedRecords(projects)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function makeSnapshot(projects, paths, publishedAt = new Date().toISOString()) {
  const records = publishedRecords(projects);
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    source_version: await publicationVersion(projects),
    published_at: publishedAt,
    projects: records.map(project => ({
      ...project, id: project.slug, public_path: `projetos/${project.slug}/`,
      cover_path: project.slug + '/' + project.media.findIndex(media => media.path === project.cover_path),
      // Identity is separate from the content hash: repeating the same image
      // must not collapse two deliberately positioned gallery entries.
      media: project.media.map((media, index) => ({ ...media, path: project.slug + '/' + index, local: paths.get(media.path) })),
    })),
  };
  return validateSnapshot(snapshot);
}

function onlyKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Campo inesperado na publicação.');
}

export function validateStatus(status) {
  onlyKeys(status, ['schema','source_version','published_at','total']);
  if (status.schema !== SNAPSHOT_SCHEMA || typeof status.source_version !== 'string' || !/^[a-f0-9]{64}$/.test(status.source_version) || typeof status.published_at !== 'string' || !Number.isFinite(Date.parse(status.published_at)) || !Number.isInteger(status.total) || status.total < 0 || status.total > MAX_PUBLISHED_PROJECTS) throw new Error('Estado de publicação inválido.');
  return status;
}

export function snapshotStatus(snapshot) {
  return validateStatus({ schema: snapshot.schema, source_version: snapshot.source_version, published_at: snapshot.published_at, total: snapshot.projects.length });
}

export function validateSnapshot(snapshot) {
  onlyKeys(snapshot, ['schema','source_version','published_at','projects']);
  if (!Array.isArray(snapshot.projects)) throw new Error('Publicação incompleta.');
  snapshotStatus(snapshot);
  for (const project of snapshot.projects) {
    onlyKeys(project, ['id','slug','title','category','description','position','status','cover_layout','cover_path','card_layout','media','public_path']);
    if (project.public_path !== `projetos/${project.slug}/`) throw new Error('Endereço estático inválido.');
    if (project.status !== 'published' || project.id !== project.slug || !Array.isArray(project.media)) throw new Error('Conteúdo não publicado no arquivo público.');
    for (const [index, media] of project.media.entries()) {
      onlyKeys(media, ['path','local','alt','width','align']);
      if (typeof media.local !== 'string' || typeof media.alt !== 'string' || !publicImagePath.test(media.local) || media.path !== project.slug + '/' + index) throw new Error('Imagem fora da publicação local.');
    }
  }
  publishedRecords(snapshot.projects);
  return snapshot;
}

export async function readPublished(base = '/', fetcher = fetch) {
  const response = await fetcher(base + SNAPSHOT_FILE, { cache: 'no-cache', credentials: 'omit' });
  if (!response.ok) throw new Error('Não foi possível carregar a versão publicada.');
  return validateSnapshot(await response.json());
}
