import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { works, detail } from '../src/render.js';
import { home, about, contact } from '../src/content.js';
import { pageNavigation, homeIcon } from '../src/navigation.js';
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
  const links = [['home', '', 'Início'], ['work', 'projetos/', 'Projetos'], ['about', 'sobre/', 'Sobre'], ['contact', 'contato/', 'Contato']];
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">${security}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#ffffff"><title>${e(title)}</title><meta name="description" content="${e(description)}"><link rel="icon" href="${icon}"><script type="module" src="/src/site.js"></script></head>
<body><a class="skip-link" href="#conteudo">Pular para o conteúdo</a><div class="site-shell"><header class="site-header"><nav aria-label="Navegação principal">${links.map(([key, path, text]) => `<a href="${base + path}"${(page === key || (page === 'project' && key === 'work')) ? ' aria-current="page"' : ''}>${text}</a>`).join('')}<span class="nav-highlight" aria-hidden="true"></span></nav></header>${page !== 'home' ? `<div data-page-controls>${pageNavigation(page, base)}</div>` : ''}<main id="conteudo" tabindex="-1" data-page="${page}" data-slug="${e(slug)}">${content}</main>${page === 'home' ? pageNavigation(page, base) : ''}<footer class="site-footer"><a class="footer-name" href="${base}" aria-label="Camylle Teske, início">Camylle Teske</a><div class="footer-socials"><a href="https://www.instagram.com/camyteske/" target="_blank" rel="noopener noreferrer" aria-label="Instagram de Camylle Teske">Instagram ↗</a><a href="https://www.behance.net/camylleteske" target="_blank" rel="noopener noreferrer" aria-label="Behance de Camylle Teske">Behance ↗</a></div><div class="footer-meta"><p>Todos os trabalhos © Camylle Teske · 2026</p><a href="${base}privacidade/">Privacidade</a><button type="button" class="privacy-preferences" data-privacy-open>Preferências de privacidade</button></div><a class="back-top" href="#conteudo">Voltar ao topo ↑</a></footer></div></body></html>`;
}

async function page(path, html) {
  const file = new URL('../' + path, import.meta.url);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, html);
}

await page('index.html', shell('Camylle Teske — Portfólio', 'Portfólio de Camylle Teske. Branding, campanhas, conteúdo digital e design de embalagem.', home(base), 'home'));
await page('projetos/index.html', shell('Projetos — Camylle Teske', 'Projetos selecionados de Camylle Teske.', live ? loading : works(projects, base), 'work'));
await page('sobre/index.html', shell('Sobre — Camylle Teske', 'Conheça Camylle Teske, designer e artista visual.', about(base), 'about'));
await page('contato/index.html', shell('Contato — Camylle Teske', 'Entre em contato com Camylle Teske por e-mail ou nas redes sociais.', contact(base), 'contact'));
await page('privacidade/index.html', shell('Privacidade — Camylle Teske', 'Suas escolhas de privacidade e estatísticas de acesso do portfólio.', `<article class="privacy-policy"><h1>Privacidade e suas escolhas</h1><p>Você pode navegar pelo portfólio sem aceitar estatísticas. A escolha de aceitar ou recusar fica somente neste navegador e pode ser alterada pelo botão abaixo ou pelo rodapé.</p><button type="button" class="privacy-preferences" data-privacy-open>Alterar minhas preferências</button><h2>Estatísticas opcionais</h2><p>Somente após sua autorização, somamos acessos por dia e por página pública. Não guardamos nomes, e-mails, IPs, localização, características do aparelho ou identificadores de visitantes nessas estatísticas. Não criamos perfis individuais e não usamos cookies de rastreamento.</p><p>Um acesso é uma visualização de página, não uma pessoa única. Uma mesma pessoa pode gerar vários acessos. Quem recusa não entra nessa contagem. Parar de autorizar impede os próximos envios; os totais anteriores não permitem identificar ou separar uma pessoa.</p><h2>Armazenamento e acesso</h2><p>As contagens ficam no Supabase e só podem ser consultadas pelos administradores autorizados do portfólio. Os relatórios cobrem até um ano; contagens mais antigas são limpas conforme o site recebe novos acessos. Guardamos a preferência neste navegador, sem criar um identificador individual. O login no painel usa armazenamento separado e não é usado para identificar visitas.</p><p>GitHub Pages e Supabase processam dados técnicos de conexão para entregar e proteger seus serviços. Esses dados técnicos não compõem o nosso relatório de acessos.</p><h2>Contato</h2><p>Para conversar sobre privacidade, escreva para <a class="text-link" href="mailto:teske.camy@gmail.com">teske.camy@gmail.com</a>.</p></article>`, 'privacy'));
await page('projeto/index.html', shell('Trabalho — Camylle Teske', 'Trabalhos de Camylle Teske.', '<p class="page-message" role="status">Carregando trabalho…</p>', 'project'));
for (const project of projects) await page(`projetos/${project.slug}/index.html`, shell(`${project.title} — Camylle Teske`, project.description, live ? loading : detail(project, projects, base), 'project', project.slug));
await page('404.html', shell('Página não encontrada — Camylle Teske', 'Portfólio de Camylle Teske.', `<div class="page-message"><h1>Página não encontrada.</h1><p><a class="text-link" href="${base}">Conheça os trabalhos</a></p></div>`, '404'));
await page('admin/index.html', `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${security}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#ffffff"><title>Painel — Camylle Teske</title><link rel="icon" href="${icon}"><script type="module" src="/src/admin.js"></script></head><body class="admin-body"><header class="admin-header"><a class="brand" href="${base}">Camylle Teske</a><div class="admin-header-actions"><a class="text-link" data-admin-home href="${base}admin/">${homeIcon}Início do painel</a><a class="text-link" href="${base}" target="_blank" rel="noopener noreferrer">Ver portfólio ↗</a></div></header><main id="admin" class="admin-main"><p role="status">Carregando painel…</p></main></body></html>`);
console.log('Páginas do portfólio e painel geradas.');
