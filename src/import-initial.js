import initialProjects from './initial-projects.json';
import { client, saveProject } from './backend.js';
import { BUCKET } from './project.js';

export function initialImportState(existing) {
  const initialIds = new Set(initialProjects.map(p => p.id));
  const imported = existing.filter(p => initialIds.has(p.id)).length;
  return { imported, pending: initialProjects.length - imported };
}

export async function importInitial(existing, onProgress) {
  const knownIds = new Set(existing.map(p => p.id));
  const pending = initialProjects.filter(p => !knownIds.has(p.id));
  for (let index = 0; index < pending.length; index++) {
    const project = pending[index];
    onProgress(`Importando ${project.title} (${index + 1} de ${pending.length})…`);
    for (const media of project.media) {
      const response = await fetch(import.meta.env.BASE_URL + media.local);
      if (!response.ok) throw new Error(`Não foi possível carregar a imagem de ${project.title}.`);
      const file = await response.blob();
      const contentType = media.path.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { error } = await client.storage.from(BUCKET).upload(media.path, file, { contentType, cacheControl: '300', upsert: true });
      if (error) throw error;
    }
    await saveProject(project);
  }
  return pending.length;
}
