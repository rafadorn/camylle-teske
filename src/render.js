import { coverMedia, escapeHTML as e } from './project.js';

export function projectURL(project, base = '/') {
  return `${base}projeto/?trabalho=${encodeURIComponent(project.slug)}`;
}

function image(media, base, lazy = true) {
  const src = media.url || (media.local ? base + media.local : '');
  return `<img src="${e(src)}" data-media-path="${e(media.path)}" alt="${e(media.alt)}"${lazy ? ' loading="lazy"' : ''}>`;
}

export function card(project, base = '/', lazy = true) {
  return `<a class="project project-card" href="${e(projectURL(project, base))}" aria-label="Ver projeto ${e(project.title)}"><span class="card-inner"><span class="project-cover"><span class="project-image${project.cover_layout === 'triptych' ? ' triptych' : ''}">${coverMedia(project).map(m => image(m, base, lazy)).join('')}</span></span><span class="project-caption card-copy"><strong>${e(project.title)}</strong><small>${e(project.category)}</small></span></span></a>`;
}

export function works(projects, base = '/') {
  const groups = [];
  for (let i = 0; i < projects.length; i += 6) {
    const group = projects.slice(i, i + 6);
    groups.push(`<div class="project-grid gallery" data-count="${group.length}">${group.map((p, index) => card(p, base, i + index > 2)).join('')}</div>`);
  }
  return `<section class="works-view work-section" aria-labelledby="work-title"><div class="section-line"><h1 id="work-title" class="tiny-label">Projetos selecionados</h1><span>${projects.length ? '01 — ' + String(projects.length).padStart(2, '0') : '00'}</span></div>${groups.join('')}${projects.length ? '' : '<p class="page-message">Novos trabalhos chegam em breve.</p>'}</section>`;
}

export function detail(project, projects = [], base = '/') {
  const cover = coverMedia(project);
  const paths = new Set(cover.map(m => m.path));
  const rest = project.media.filter(m => !paths.has(m.path));
  const index = projects.findIndex(p => p.id === project.id);
  const next = projects.length > 1 ? projects[(index + 1) % projects.length] : null;
  return `<article class="project-detail project-view"><div class="page-kicker"><a class="project-return" href="${base}projetos/">← Todos os trabalhos</a>${index >= 0 ? `<span>${String(index + 1).padStart(2, '0')} / ${String(projects.length).padStart(2, '0')}</span>` : ''}</div><div class="project-info project-heading"><h1>${e(project.title)}</h1><div class="project-summary"><p class="tiny-label">${e(project.category)}</p><p class="description">${e(project.description)}</p></div></div><div class="project-cover project-gallery${project.cover_layout === 'triptych' ? ' triptych' : ''}">${cover.map(m => image(m, base, false)).join('')}</div>${rest.length ? `<div class="detail-gallery project-gallery">${rest.map(m => image(m, base)).join('')}</div>` : ''}${next ? `<a class="project-next" href="${e(projectURL(next, base))}"><div><span class="tiny-label">Próximo trabalho</span><strong>${e(next.title)}</strong></div><span aria-hidden="true">↗</span></a>` : ''}</article>`;
}
