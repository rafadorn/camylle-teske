import initialProjects from './initial-projects.json';
import { client, saveProject } from './backend.js';
import { BUCKET } from './project.js';

export function initialImportState(existing) {
  const initialIds = new Set(initialProjects.map(p => p.id));
  const imported = existing.filter(p => initialIds.has(p.id)).length;
  return { imported, pending: initialProjects.length - imported };
}

export async function importInitial(existing, onProgress, shouldContinue = () => true) {
  const knownIds = new Set(existing.map(p => p.id));
  const pending = initialProjects.filter(p => !knownIds.has(p.id));
  for (let index = 0; index < pending.length; index++) {
    if (!shouldContinue()) return index;
    const project = pending[index];
    onProgress(`Importando ${project.title} (${index + 1} de ${pending.length})…`);
    for (const media of project.media) {
      if (!shouldContinue()) return index;
      const response = await fetch(import.meta.env.BASE_URL + media.local);
      if (!shouldContinue()) return index;
      if (!response.ok) throw new Error(`Não foi possível carregar a imagem de ${project.title}.`);
      const file = await response.blob();
      if (!shouldContinue()) return index;
      const contentType = media.path.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { error } = await client.storage.from(BUCKET).upload(media.path, file, { contentType, cacheControl: '300', upsert: true });
      if (!shouldContinue()) return index;
      if (error) throw error;
    }
    if (!shouldContinue()) return index;
    await saveProject(project);
    if (!shouldContinue()) return index + 1;
  }
  return pending.length;
}
