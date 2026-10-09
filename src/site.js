import './styles.css';
import initialProjects from './initial-projects.json';
import { configured, listProjects } from './backend.js';
import { works, detail } from './render.js';

const main = document.querySelector('main');
const page = main.dataset.page;
const base = import.meta.env.BASE_URL;

async function load() {
  if (!['work', 'project'].includes(page)) return;
  // A versão estática só é usada antes de ativar o banco, nunca em uma falha dele.
  if (configured) main.innerHTML = '<p class="page-message" role="status">Carregando trabalhos…</p>';
  try {
    const projects = configured ? await listProjects() : initialProjects;
    if (page === 'work') { main.innerHTML = works(projects, base); return; }
    const slug = main.dataset.slug || new URLSearchParams(location.search).get('trabalho');
    const project = projects.find(p => p.slug === slug);
    if (!project) {
      document.title = 'Trabalho não encontrado — Camylle Teske';
      main.innerHTML = `<div class="page-message"><h1>Trabalho não encontrado.</h1><p><a class="text-link" href="${base}">Ver todos os trabalhos</a></p></div>`;
      return;
    }
    document.title = `${project.title} — Camylle Teske`;
    document.querySelector('meta[name="description"]').content = project.description;
    main.innerHTML = detail(project, projects, base);
  } catch {
    main.innerHTML = '<div class="page-message" role="alert"><p>Não foi possível carregar os trabalhos agora.</p><button type="button" class="retry">Tentar novamente</button></div>';
    main.querySelector('button').addEventListener('click', load);
  }
}
load();
// Atualiza as URLs de mídia quando a aba volta a ser usada.
document.addEventListener('visibilitychange', () => { if (!document.hidden && configured) load(); });
setInterval(async () => {
  if (!configured || document.hidden || !['work', 'project'].includes(page)) return;
  try {
    const projects = await listProjects();
    const urls = new Map(projects.flatMap(p => p.media.map(m => [m.path, m.url])));
    main.querySelectorAll('img[data-media-path]').forEach(image => { if (urls.has(image.dataset.mediaPath)) image.src = urls.get(image.dataset.mediaPath); });
  } catch { /* Uma falha temporária não apaga uma página já carregada. */ }
}, 240_000);
