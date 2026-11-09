// Deployment smoke check: GET only, without executing analytics or accessing accounts.
import assert from 'node:assert/strict';

const site = new URL(process.env.PORTFOLIO_URL || 'https://camylle-teske.com.br/');
assert.equal(site.protocol, 'https:');
const checks = [
  ['', 'data-page="home"', 'class="wordmark"'],
  ['projetos/', 'data-page="work"', 'Carregando trabalhos'],
  ['sobre/', 'data-page="about"', 'about-title'],
  ['contato/', 'data-page="contact"', 'mailto:teske.camy@gmail.com'],
  ['privacidade/', 'data-page="privacy"', 'Privacidade e suas escolhas'],
  ['admin/', 'noindex,nofollow', 'src='],
  ['projetos/odara-tattoo/', 'data-page="project"', 'data-slug="odara-tattoo"'],
];
async function read(path) {
  const response = await fetch(new URL(path, site), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  assert.equal(new URL(response.url).protocol, 'https:');
  return response;
}
let home;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    home = await (await read('')).text();
    assert.ok(home.includes('data-page="home"') && home.includes('class="wordmark"'));
    break;
  } catch (error) {
    if (attempt === 29) throw error;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
for (const [path, ...expected] of checks) {
  const html = path ? await (await read(path)).text() : home;
  for (const text of expected) assert.ok(html.includes(text), `${path}: missing ${text}`);
  assert.ok(html.includes("script-src 'self'") && html.includes("object-src 'none'"), `${path}: security policy`);
  assert.ok(!html.includes('@@') && !html.includes('Proposta visual 01'), `${path}: no approval placeholders`);
}
const stylePath = home.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
assert.ok(stylePath, 'production stylesheet');
const css = await (await read(stylePath)).text();
assert.ok(css.includes('Bogue Light PDF') && css.includes('wordmark'), 'cover typography');
for (const font of ['fonts/bogue-light-pdf.woff', 'fonts/acid-grotesk-light-pdf.woff']) {
  const response = await read(font);
  assert.ok(!response.headers.get('content-type')?.includes('text/html'));
  assert.ok((await response.arrayBuffer()).byteLength > 1000, font);
}
console.log('Public site OK: HTTPS, cover, pages, old project routes, fonts and CSP. No analytics events generated.');
