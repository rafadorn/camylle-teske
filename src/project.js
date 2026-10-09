export const BUCKET = 'portfolio';
export const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function slugify(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/g, '');
}

export function escapeHTML(text = '') {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function validateProject(project) {
  if (!project.title?.trim()) throw new Error('Escreva o título do trabalho.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug || '')) throw new Error('Use letras, números e hífens no endereço do trabalho.');
  if (project.title.length > 160 || project.category.length > 160 || project.description.length > 12000) throw new Error('O texto ultrapassa o limite do campo.');
  if (!Number.isInteger(project.position) || project.position < 1) throw new Error('A posição deve ser um número inteiro a partir de 1.');
  if (!['draft', 'published'].includes(project.status)) throw new Error('Escolha um estado válido para o trabalho.');
  if (!['single', 'triptych'].includes(project.cover_layout)) throw new Error('Escolha uma composição de capa válida.');
  if (project.media.length > 40) throw new Error('Use até 40 imagens por trabalho.');
  if (project.status === 'published') {
    if (!project.category.trim() || !project.description.trim()) throw new Error('Preencha a categoria e a descrição antes de publicar.');
    if (!project.cover_path || !project.media.some(m => m.path === project.cover_path)) throw new Error('Escolha uma imagem como capa antes de publicar.');
    if (project.cover_layout === 'triptych' && project.media.length < 3) throw new Error('A capa com três imagens precisa de pelo menos três imagens.');
  }
  return project;
}

export function validateImage(file) {
  if (!IMAGE_TYPES.has(file.type)) throw new Error(`${file.name}: use uma imagem JPG, PNG ou WebP.`);
  if (file.size > MAX_IMAGE_SIZE) throw new Error(`${file.name}: a imagem deve ter até 8 MB.`);
}

export function recordForSave(project) {
  return {
    id: project.id, title: project.title.trim(), slug: project.slug,
    category: project.category.trim(), description: project.description.trim(),
    position: project.position, status: project.status, cover_layout: project.cover_layout,
    cover_path: project.cover_path || null,
    media: project.media.map(({ path, alt }) => ({ path, alt: alt || '' })),
  };
}

export function coverMedia(project) {
  return project.cover_layout === 'triptych'
    ? project.media.slice(0, 3)
    : project.media.filter(m => m.path === project.cover_path).slice(0, 1);
}
