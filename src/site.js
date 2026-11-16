import { createPrivacy } from './privacy.js';
import './styles.css';
import './privacy.css';
import './layout.css';
import './menu.js';
import './navigation.css';
import { pageNavigation, projectNavigation } from './navigation.js';
import { readPublished } from './publication.js';
import { works, detail } from './render.js';

const main = document.querySelector('main');
const page = main.dataset.page;
const base = import.meta.env.BASE_URL;
const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const privacy = createPrivacy({ base, endpoint: configured ? import.meta.env.VITE_SUPABASE_URL + '/functions/v1/record-portfolio-view' : '', publicKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '' });
if (page === 'home') privacy?.page('/');
if (page === 'about') privacy?.page('/sobre/');
if (page === 'contact') privacy?.page('/contato/');
if (page === 'privacy') privacy?.page('/privacidade/');

async function load() {
  if (!['work', 'project'].includes(page)) return;
  if (page === 'project') document.querySelector('[data-page-controls]').innerHTML = pageNavigation('project', base);
  try {
    // The public site reads its own complete publication, never the live database.
    const { projects } = await readPublished(base);
    if (page === 'work') { main.innerHTML = works(projects, base); privacy?.page('/projetos/'); return; }
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
    document.querySelector('[data-page-controls]').innerHTML = projectNavigation(project, projects, base);
    privacy?.page('/projetos/' + project.slug + '/');
  } catch {
    // Pre-rendered pages remain useful if the local JSON temporarily fails.
    if (main.querySelector('.works-view,.project-detail')) return;
    main.innerHTML = '<div class="page-message" role="alert"><p>Não foi possível carregar os trabalhos agora.</p><button type="button" class="retry">Tentar novamente</button></div>';
    main.querySelector('button').addEventListener('click', load);
  } finally { main.dataset.publicationReady = 'true'; }
}
load();
