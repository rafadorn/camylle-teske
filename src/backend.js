import { createClient } from '@supabase/supabase-js';
import { BUCKET, recordForSave } from './project.js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
if (key.startsWith('sb_secret_')) throw new Error('Use somente a chave publicável no site.');
if (key.split('.').length === 3) {
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role === 'service_role') throw new Error('A chave service_role não pode ser usada no site.');
  } catch (error) { if (error.message.includes('service_role')) throw error; }
}
export const configured = Boolean(url && key);
export const client = configured ? createClient(url, key) : null;

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function friendlyError(error) {
  if (error?.code === '23505') return 'Esse endereço já pertence a outro trabalho. Escolha outro.';
  if (error?.code === '42501' || /row.level security|permission denied/i.test(error?.message || '')) return 'Sua conta não tem permissão para editar o portfólio.';
  if (/Invalid login credentials/i.test(error?.message || '')) return 'E-mail ou senha incorretos.';
  if (/fetch|network|Failed to fetch/i.test(error?.message || '')) return 'Não foi possível conectar. Confira sua internet e tente novamente.';
  return error?.message || 'Não foi possível concluir. Tente novamente.';
}

export async function mediaURLs(projects) {
  const paths = [...new Set(projects.flatMap(p => p.media.map(m => m.path)))];
  if (!paths.length) return projects;
  // URLs curtas limitam o acesso depois que um trabalho volta a ser rascunho.
  const signed = check(await client.storage.from(BUCKET).createSignedUrls(paths, 300));
  if (signed.some(m => m.error || !m.signedUrl)) throw new Error('Não foi possível carregar as imagens do trabalho.');
  const urls = new Map(signed.map(item => [item.path, item.signedUrl]));
  return projects.map(p => ({ ...p, media: p.media.map(m => ({ ...m, url: urls.get(m.path) })) }));
}

export async function listProjects(admin = false) {
  let query = client.from('projects').select('*').order('position').order('created_at');
  if (!admin) query = query.eq('status', 'published');
  return mediaURLs(check(await query));
}

export async function saveProject(project) {
  return check(await client.from('projects').upsert(recordForSave(project)).select().single());
}

export async function uploadImage(projectId, file) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${projectId}/${crypto.randomUUID()}.${extension}`;
  check(await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '300', upsert: false }));
  return path;
}

export async function removeImages(paths) {
  if (paths.length) check(await client.storage.from(BUCKET).remove(paths));
}

export async function deleteProject(id, paths) {
  // Excluir o registro primeiro remove o acesso público mesmo se a limpeza falhar.
  check(await client.from('projects').delete().eq('id', id));
  await removeImages(paths);
}

export async function reorderProjects(ids) {
  check(await client.rpc('reorder_projects', { project_ids: ids }));
}
