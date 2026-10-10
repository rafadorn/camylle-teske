import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { works, detail } from '../src/render.js';
import { escapeHTML as e } from '../src/project.js';
import { loadEnv } from 'vite';
import { validatePublicConfig, withProjectDefaults } from './public-config.mjs';
import { securityMeta } from './security-policy.mjs';

const projects = JSON.parse(await readFile(new URL('../src/initial-projects.json', import.meta.url), 'utf8'));
const base = '%BASE_URL%';
const config = withProjectDefaults(loadEnv('production', process.cwd(), ''));
const live = validatePublicConfig(config);
const security = securityMeta(config.VITE_SUPABASE_URL);
const loading = '<p class="page-message" role="status">Carregando trabalhos…</p><noscript><p class="page-message">Ative o JavaScript para ver os trabalhos atualizados.</p></noscript>';
const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='white'/%3E%3Ctext x='32' y='43' text-anchor='middle' font-family='Arial,sans-serif' font-size='29' fill='black'%3ECT%3C/text%3E%3C/svg%3E";

function shell(title, description, content, page, slug = '') {
  const links = [['work', '', 'Trabalhos'], ['about', 'sobre/', 'Sobre'], ['contact', 'contato/', 'Contato']];
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">${security}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#ffffff"><title>${e(title)}</title><meta name="description" content="${e(description)}"><link rel="icon" href="${icon}"><script type="module" src="/src/site.js"></script></head>
<body><a class="skip-link" href="#conteudo">Pular para o conteúdo</a><header class="site-header"><a class="brand" href="${base}" aria-label="Camylle Teske, início">Camylle Teske</a><nav aria-label="Navegação principal">${links.map(([key, path, text]) => `<a href="${base + path}"${(page === key || (page === 'project' && key === 'work')) ? ' aria-current="page"' : ''}>${text}</a>`).join('')}</nav></header><main id="conteudo" data-page="${page}" data-slug="${e(slug)}">${content}</main><footer><p>Todos os trabalhos © Camylle Teske · 2026</p><a class="text-link" href="https://www.behance.net/camylleteske" target="_blank" rel="noopener noreferrer">Behance</a><a class="text-link" href="#conteudo">Voltar ao topo</a></footer></body></html>`;
}

async function page(path, html) {
  const file = new URL('../' + path, import.meta.url);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, html);
}

await page('index.html', shell('Camylle Teske — Portfólio', 'Portfólio de Camylle Teske. Branding, campanhas, conteúdo digital e design de embalagem.', live ? loading : works(projects, base), 'work'));
await page('sobre/index.html', shell('Sobre — Camylle Teske', 'Conheça Camylle Teske, designer e pesquisadora em arte e design.', `<section class="about-section" aria-labelledby="about-title"><figure class="portrait"><img src="${base}images/camylle-teske.jpeg" width="1067" height="1600" alt="Camylle Teske em frente a um painel de trabalhos gráficos."></figure><div class="about-copy"><p class="eyebrow">Sobre</p><h1 id="about-title">Camylle Teske</h1><p class="lead">Designer e pesquisadora<br>em arte e design.</p><p>Sou formada em Design e estudante de Artes Visuais. Atuo como designer com foco em branding, campanhas e conteúdo digital.</p><p>Tenho especial interesse em design editorial e escrita como extensões do meu processo criativo.</p><a class="text-link" href="${base}">Conheça meu trabalho</a></div></section>`, 'about'));
await page('contato/index.html', shell('Contato — Camylle Teske', 'Entre em contato com Camylle Teske por e-mail ou nas redes sociais.', `<section class="contact-section" aria-labelledby="contact-title"><p class="eyebrow">Contato</p><h1 id="contact-title">Vamos conversar?</h1><p>Para conhecer mais do meu trabalho ou conversar sobre um projeto, entre em contato. Você também me encontra nas redes abaixo.</p><a class="contact-email" href="mailto:teske.camy@gmail.com">teske.camy@gmail.com<span aria-hidden="true">↗</span></a><ul class="contact-socials" aria-label="Redes sociais"><li><a class="text-link" href="https://www.behance.net/camylleteske" target="_blank" rel="noopener noreferrer">Behance</a></li><li><a class="text-link" href="https://www.instagram.com/camyteske/" target="_blank" rel="noopener noreferrer">Instagram</a></li><li><a class="text-link" href="https://www.linkedin.com/in/camylle-teske-62a539330/" target="_blank" rel="noopener noreferrer">LinkedIn</a></li></ul></section>`, 'contact'));
await page('projeto/index.html', shell('Trabalho — Camylle Teske', 'Trabalhos de Camylle Teske.', '<p class="page-message" role="status">Carregando trabalho…</p>', 'project'));
for (const project of projects) await page(`projetos/${project.slug}/index.html`, shell(`${project.title} — Camylle Teske`, project.description, live ? loading : detail(project, projects, base), 'project', project.slug));
await page('404.html', shell('Página não encontrada — Camylle Teske', 'Portfólio de Camylle Teske.', `<div class="page-message"><h1>Página não encontrada.</h1><p><a class="text-link" href="${base}">Conheça os trabalhos</a></p></div>`, '404'));
await page('admin/index.html', `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${security}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#ffffff"><title>Painel — Camylle Teske</title><link rel="icon" href="${icon}"><script type="module" src="/src/admin.js"></script></head><body class="admin-body"><header class="admin-header"><a class="brand" href="${base}">Camylle Teske</a><a class="text-link" href="${base}" target="_blank" rel="noopener noreferrer">Ver portfólio</a></header><main id="admin" class="admin-main"><p role="status">Carregando painel…</p></main></body></html>`);
console.log('Páginas do portfólio e painel geradas.');
