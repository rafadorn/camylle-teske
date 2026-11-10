import { escapeHTML as e } from './project.js';
import { projectURL } from './render.js';

export const homeIcon = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3 10 9-7 9 7v10H6V10m3 10v-7h6v7"/></svg>';
const pages = [
  { key: 'home', path: '', label: 'Início' },
  { key: 'work', path: 'projetos/', label: 'Projetos' },
  { key: 'about', path: 'sobre/', label: 'Sobre' },
  { key: 'contact', path: 'contato/', label: 'Contato' },
];

function directions(previous, next, base, home = false) {
  const link = (target, forward) => target ? `<a class="page-nav-link page-nav-${forward ? 'next' : 'previous'}" href="${e(target.href || base + target.path)}" aria-label="${forward ? 'Avançar' : 'Voltar'} para ${e(target.label)}"><span>${forward ? 'Avançar →' : '← Voltar'}</span><small>${e(target.label)}</small></a>` : '<span aria-hidden="true"></span>';
  return `<nav class="page-controls${home ? ' page-controls-home' : ''}" aria-label="Navegação entre páginas">${link(previous, false)}${home ? '<span aria-hidden="true"></span>' : `<a class="page-nav-link page-nav-home" href="${e(base)}" aria-label="Voltar à página inicial">${homeIcon}<span>Início</span></a>`}${link(next, true)}</nav>`;
}

export function pageNavigation(page, base = '/') {
  const index = pages.findIndex(item => item.key === page);
  if (index >= 0) return directions(pages[index - 1], pages[index + 1], base, page === 'home');
  return directions(pages[1], page === 'privacy' ? pages[3] : null, base);
}

export function projectNavigation(project, projects, base = '/') {
  const index = projects.findIndex(item => item.id === project.id);
  if (index < 0 || projects.length < 2) return pageNavigation('project', base);
  const previous = projects[(index + projects.length - 1) % projects.length];
  const next = projects[(index + 1) % projects.length];
  return directions({ href: projectURL(previous, base), label: previous.title }, { href: projectURL(next, base), label: next.title }, base);
}
