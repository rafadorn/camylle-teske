import { coverMedia, escapeHTML as e } from './project.js';

export function projectURL(project, base = '/') {
  return `${base}projeto/?trabalho=${encodeURIComponent(project.slug)}`;
}

function image(media, base, lazy = true) {
  const src = media.url || (media.local ? base + media.local : '');
  return `<img src="${e(src)}" data-media-path="${e(media.path)}" alt="${e(media.alt)}"${lazy ? ' loading="lazy"' : ''}>`;
}

export function card(project, base = '/', lazy = true) {
  return `<a class="project" href="${e(projectURL(project, base))}" aria-label="Ver projeto ${e(project.title)}"><span class="project-image${project.cover_layout === 'triptych' ? ' triptych' : ''}">${coverMedia(project).map(m => image(m, base, lazy)).join('')}</span><span class="project-caption"><strong>${e(project.title)}</strong><span>${e(project.category)}</span></span></a>`;
}

export function works(projects, base = '/') {
  return `<section class="work-section" aria-labelledby="work-title"><h1 id="work-title" class="sr-only">Portfólio de Camylle Teske</h1><div class="project-grid">${projects.map((p, i) => card(p, base, i > 2)).join('')}</div>${projects.length ? '' : '<p class="page-message">Novos trabalhos chegam em breve.</p>'}</section>`;
}

export function detail(project, projects = [], base = '/') {
  const cover = coverMedia(project);
  const rest = project.cover_layout === 'triptych' ? project.media : project.media.filter(m => m.path !== project.cover_path);
  const related = projects.filter(p => p.id !== project.id).slice(0, 3);
  return `<article class="project-detail"><div class="project-cover${project.cover_layout === 'triptych' ? ' triptych' : ''}">${cover.map(m => image(m, base, false)).join('')}</div><div class="project-info"><p class="eyebrow">${e(project.category)}</p><h1>${e(project.title)}</h1><p class="description">${e(project.description)}</p></div>${rest.length ? `<div class="detail-gallery">${rest.map(m => image(m, base)).join('')}</div>` : ''}</article>${related.length ? `<section class="related" aria-labelledby="more-title"><h2 id="more-title">Veja também</h2><div class="project-grid">${related.map(p => card(p, base)).join('')}</div></section>` : ''}<p class="back-work"><a class="text-link" href="${base}">Todos os trabalhos</a></p>`;
}
