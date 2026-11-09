// Contrato HTTP de teste. Nunca é incluído no site publicado.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { brazilDay } from '../src/analytics-path.js';

const origin = 'http://127.0.0.1:4179';
const api = 'https://camylle-test.supabase.co';
const base = process.env.TEST_BASE_PATH || '/';
const seed = JSON.parse(await readFile(new URL('../src/initial-projects.json', import.meta.url), 'utf8'));
let projects = structuredClone(seed);
const upload = await readFile(new URL('../public/images/vestis.png', import.meta.url));
const requests = [];
const analyticsEvents = [];
const fixtureDirectory = await mkdtemp(join(tmpdir(), 'camylle-browser-'));
const fixtureBuild = join(fixtureDirectory, 'dist');
const fixtureEnv = { ...process.env, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only', VITE_BASE_PATH: base };
// QA uses a separate production bundle; restore the real source configuration.
const restorePages = () => {
  const result = spawnSync('node', ['scripts/generate-pages.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
};
let server, browser;
try {
  for (const args of [['scripts/generate-pages.mjs'], ['node_modules/vite/bin/vite.js', 'build', '--outDir', fixtureBuild, '--emptyOutDir']]) {
    const result = spawnSync('node', args, { env: fixtureEnv, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  restorePages();
  server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--outDir', fixtureBuild, '--host', '127.0.0.1', '--port', '4179', '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
  env: fixtureEnv,
});
  let serverOutput = ''; server.stdout.on('data', data => serverOutput += data); server.stderr.on('data', data => serverOutput += data);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(origin + base); if (response.ok) break; } catch { /* Ainda iniciando. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let allowAdmin = true, recoverFails = false, passwordUpdateFails = false;
  let passwordUpdates = 0;
  const tokenPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'camy@example.test', app_metadata: {}, user_metadata: {} };
  const token = `${tokenPart({ alg: 'HS256', typ: 'JWT' })}.${tokenPart({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-only`;
  async function fixture(route) {
    const request = route.request(), url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}`);
    const body = request.postData() ? (() => { try { return request.postDataJSON(); } catch { return {}; } })() : {};
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname === '/auth/v1/token') {
      if (body.password === 'wrong') return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }, 400);
      return json({ access_token: token, refresh_token: 'fixture-refresh-token', expires_in: 3600, token_type: 'bearer', user });
    }
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'PUT') {
        passwordUpdates++;
        if (passwordUpdateFails) return json({ msg: 'Falha temporária ao atualizar.', code: 'unexpected_failure' }, 500);
      }
      return json(user);
    }
    if (url.pathname === '/auth/v1/recover') return recoverFails ? json({ msg: 'Falha temporária no envio.', code: 'email_send_failed' }, 400) : json({});
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname === '/rest/v1/rpc/portfolio_access') return json(allowAdmin);
    if (url.pathname === '/rest/v1/rpc/portfolio_analytics') return allowAdmin ? json([{ view_day: brazilDay(), page_path: '/', views: 3 }, { view_day: brazilDay(), page_path: '/sobre/', views: 2 }]) : json({ message: 'permission denied', code: '42501' }, 403);
    if (url.pathname === '/functions/v1/record-portfolio-view') { analyticsEvents.push({ body, headers: request.headers() }); return route.fulfill({ status: 204 }); }
    if (url.pathname === '/rest/v1/rpc/reorder_projects') { projects = body.project_ids.map((id, i) => ({ ...projects.find(p => p.id === id), position: i + 1 })); return json(null); }
    if (url.pathname === '/rest/v1/projects') {
      if (request.method() === 'GET') return json(projects.filter(p => url.searchParams.get('status') !== 'eq.published' || p.status === 'published').sort((a, b) => a.position - b.position));
      if (request.method() === 'POST') {
        const record = { ...body, created_at: '2026-10-08T12:00:00Z' };
        const index = projects.findIndex(p => p.id === record.id);
        if (index < 0) projects.push(record); else projects[index] = record;
        return json(record, 201);
      }
      if (request.method() === 'DELETE') { projects = projects.filter(p => p.id !== url.searchParams.get('id')?.replace('eq.', '')); return json(null); }
    }
    if (url.pathname === '/storage/v1/object/sign/portfolio') return json(body.paths.map(path => ({ path, signedURL: `/object/sign/portfolio/${path}?token=fixture` })));
    if (url.pathname.startsWith('/storage/v1/object/sign/portfolio/')) {
      const path = decodeURIComponent(url.pathname.replace('/storage/v1/object/sign/portfolio/', ''));
      const initial = seed.flatMap(p => p.media).find(m => m.path === path);
      const bytes = initial ? await readFile(new URL('../public/' + initial.local, import.meta.url)) : upload;
      return route.fulfill({ status: 200, contentType: path.endsWith('.png') ? 'image/png' : 'image/jpeg', body: bytes });
    }
    if (url.pathname.startsWith('/storage/v1/object/portfolio/') && request.method() === 'POST') return json({ Key: url.pathname.replace('/storage/v1/object/', '') });
    if (url.pathname === '/storage/v1/object/portfolio' && request.method() === 'DELETE') return json([]);
    throw new Error(`Unhandled request: ${request.method()} ${url.pathname}`);
  }
  await context.route(api + '/**', fixture);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.goto(origin + base + 'admin/');
  await page.getByLabel('E-mail', { exact: true }).fill(user.email);
  recoverFails = true;
  await page.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Esqueci minha senha', exact: true }).isDisabled(), false);
  recoverFails = false;
  await page.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click();
  await page.getByText('Se esse e-mail estiver cadastrado, você receberá um link para trocar a senha.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Esqueci minha senha', exact: true }).isDisabled(), false);
  await page.getByLabel('Senha', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos.' }).waitFor();
  await page.getByLabel('Senha', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('heading', { name: 'Trabalhos', exact: true }).waitFor();
  assert.equal(await page.locator('.work-row').count(), 6);
  await page.getByText('Estatísticas de acesso', { exact: true }).click();
  await page.getByText('Estatísticas atualizadas.', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.analytics-totals dd').allTextContents(), ['5', '5', '5']);
  assert.equal(await page.locator('.analytics-report > .analytics-table tbody tr').count(), 2);
  await page.screenshot({ path: 'test-results/analytics-admin.png', fullPage: true });
  await page.getByText('Estatísticas de acesso', { exact: true }).click();
  await page.getByRole('button', { name: 'Subir Leão Ice Bubble Tea', exact: true }).click();
  await page.getByText('Ordem atualizada no portfólio.').waitFor();
  assert.equal(await page.locator('.row-info h2').first().textContent(), 'Leão Ice Bubble Tea');
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Novo trabalho', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Novo projeto de teste');
  await page.getByLabel('Categoria', { exact: true }).fill('Identidade visual');
  await page.getByLabel('Sobre o trabalho', { exact: true }).fill('Projeto criado para verificar o painel e a publicação.');
  await page.locator('#upload').setInputFiles({ name: 'capa.png', mimeType: 'image/png', buffer: upload });
  await page.getByText('Imagens adicionadas. Salve o trabalho para enviar.').waitFor();
  await page.getByLabel('Descrição da imagem', { exact: true }).fill('Capa do novo projeto.');
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  await page.locator('#upload').setInputFiles([
    { name: 'segunda.png', mimeType: 'image/png', buffer: upload },
    { name: 'terceira.png', mimeType: 'image/png', buffer: upload },
  ]);
  await page.getByText('3 / 40', { exact: true }).waitFor();
  await page.getByLabel('Descrição da imagem', { exact: true }).nth(1).fill('Segunda imagem.');
  await page.getByRole('button', { name: 'Subir imagem 2', exact: true }).click();
  assert.equal(await page.getByLabel('Descrição da imagem', { exact: true }).first().inputValue(), 'Segunda imagem.');
  await page.getByLabel('Composição da capa', { exact: true }).selectOption('triptych');
  await page.getByRole('button', { name: 'Salvar como rascunho', exact: true }).click();
  await page.getByText('Rascunho salvo. Ele não aparece no portfólio.').waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Novo projeto de teste', exact: true }).waitFor();
  assert.equal(await page.locator('.work-row').count(), 7);
  const publicPage = await context.newPage(); publicPage.on('pageerror', error => errors.push(error.message));
  await publicPage.goto(origin + base + 'projetos/');
  await publicPage.locator('.project').first().waitFor();
  assert.equal(await publicPage.locator('.project').count(), 6, 'draft not shown to visitors');
  await page.locator('.work-row').filter({ hasText: 'Novo projeto de teste' }).getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar e publicar', exact: true }).click();
  await page.getByText('Trabalho publicado no portfólio.').waitFor();
  await publicPage.reload();
  await publicPage.getByRole('link', { name: 'Ver projeto Novo projeto de teste', exact: true }).waitFor();
  assert.equal(await publicPage.locator('.project').count(), 7);
  await publicPage.getByRole('link', { name: 'Ver projeto Novo projeto de teste', exact: true }).click();
  await publicPage.getByRole('heading', { name: 'Novo projeto de teste', exact: true }).waitFor();
  assert.ok(publicPage.url().includes('projeto/?trabalho=novo-projeto-de-teste'));
  assert.equal(await publicPage.locator('.project-cover.triptych img').count(), 3);
  await publicPage.reload();
  await publicPage.getByRole('heading', { name: 'Novo projeto de teste', exact: true }).waitFor();
  // A atualização pública não reapresenta o conteúdo estático em uma falha do banco.
  await publicPage.route(api + '/rest/v1/projects**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'offline' }) }));
  await publicPage.goto(origin + base + 'projetos/');
  await publicPage.getByText('Não foi possível carregar os trabalhos agora.').waitFor();
  assert.equal(await publicPage.locator('.project').count(), 0);
  await publicPage.unroute(api + '/rest/v1/projects**');
  await publicPage.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await publicPage.locator('.project').first().waitFor();
  // Production CSP blocks inline script execution even if a node is inserted.
  await publicPage.evaluate(() => {
    window.__inlineScriptRan = false;
    const script = document.createElement('script');
    script.textContent = 'window.__inlineScriptRan = true';
    document.head.append(script);
  });
  assert.equal(await publicPage.evaluate(() => window.__inlineScriptRan), false);
  await publicPage.locator('.project').first().hover();
  await publicPage.waitForTimeout(400);
  assert.equal(await publicPage.locator('.project-caption').first().evaluate(node => getComputedStyle(node).opacity), '1');
  await publicPage.screenshot({ path: 'test-results/portfolio-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/admin-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('.work-row').filter({ hasText: 'Novo projeto de teste' }).getByRole('button', { name: 'Editar', exact: true }).click();
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Salvar como rascunho', exact: true }).click();
  await page.getByText('Rascunho salvo. Ele não aparece no portfólio.').waitFor();
  await publicPage.reload();
  await publicPage.locator('.project').first().waitFor();
  assert.equal(await publicPage.locator('.project').count(), 6);
  await page.locator('.work-row').filter({ hasText: 'Novo projeto de teste' }).getByRole('button', { name: 'Editar', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Excluir trabalho', exact: true }).click();
  await page.getByText('Trabalho excluído.').waitFor();
  assert.equal(await page.locator('.work-row').count(), 6);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('heading', { name: 'Oi, Camy.', exact: true }).waitFor();
  // A importação reaproveita o material original pela mesma sessão de admin.
  projects = [];
  await page.getByLabel('E-mail', { exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Importar os 6 trabalhos preparados', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Importar os 6 trabalhos preparados', exact: true }).click();
  await page.getByText('Os seis trabalhos estão no portfólio.').waitFor();
  assert.equal(projects.length, 6);
  assert.equal(await page.locator('.work-row').count(), 6);
  // Signing out in another tab removes the open editor, including dirty data.
  const otherTab = await context.newPage();
  await otherTab.goto(origin + base + 'admin/');
  await otherTab.getByRole('heading', { name: 'Trabalhos', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Novo trabalho', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Texto privado ainda não salvo');
  await otherTab.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('heading', { name: 'Oi, Camy.', exact: true }).waitFor();
  assert.equal(await page.locator('#project-form').count(), 0);
  await otherTab.close();
  // A signed-in account without the admin allowlist never gets the editor.
  allowAdmin = false;
  await page.getByLabel('E-mail', { exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('heading', { name: 'Acesso não liberado.', exact: true }).waitFor();
  assert.equal(await page.locator('#project-form').count(), 0);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  allowAdmin = true;

  // A recovery link must validate confirmation and let the user retry API errors.
  const recoveryContext = await browser.newContext();
  await recoveryContext.route(api + '/**', fixture);
  const recoveryPage = await recoveryContext.newPage();
  recoveryPage.on('pageerror', error => errors.push(error.message));
  const recoveryHash = new URLSearchParams({ access_token: token, refresh_token: 'fixture-refresh-token', expires_in: '3600', token_type: 'bearer', type: 'recovery' });
  await recoveryPage.goto(origin + base + 'admin/?senha=alterar#' + recoveryHash);
  await recoveryPage.getByRole('heading', { name: 'Nova senha.', exact: true }).waitFor();
  await recoveryPage.getByLabel('Nova senha', { exact: true }).fill('new-test-password');
  await recoveryPage.getByLabel('Repita a senha', { exact: true }).fill('different-password');
  await recoveryPage.getByRole('button', { name: 'Salvar senha', exact: true }).click();
  await recoveryPage.getByText('As senhas precisam ser iguais.', { exact: true }).waitFor();
  assert.equal(passwordUpdates, 0);
  await recoveryPage.getByLabel('Repita a senha', { exact: true }).fill('new-test-password');
  passwordUpdateFails = true;
  await recoveryPage.getByRole('button', { name: 'Salvar senha', exact: true }).click();
  await recoveryPage.getByRole('alert').filter({ hasText: 'Não foi possível atualizar sua senha.' }).waitFor();
  assert.equal(await recoveryPage.getByRole('button', { name: 'Salvar senha', exact: true }).isDisabled(), false);
  passwordUpdateFails = false;
  await recoveryPage.getByRole('button', { name: 'Salvar senha', exact: true }).click();
  await recoveryPage.getByText('Senha atualizada. Você já pode cuidar do portfólio.', { exact: true }).waitFor();
  assert.equal(recoveryPage.url(), origin + base + 'admin/');
  await recoveryContext.close();

  // The public cover uses the approved font; project counts do not limit the grid.
  const visual = await context.newPage();
  visual.on('pageerror', error => errors.push(error.message));
  await visual.goto(origin + base);
  await visual.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(visual);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root: docRoot } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '.wordmark' });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  assert.ok(fonts.some(font => font.isCustomFont && /Bogue/i.test(font.postScriptName)), 'cover renders the actual Bogue glyphs');
  await cdp.detach();
  if (await visual.locator('.privacy-banner').isVisible()) await visual.getByRole('button', { name: 'Recusar', exact: true }).click();
  await visual.screenshot({ path: 'test-results/cover-desktop.png', fullPage: true });
  const originalProjects = structuredClone(projects);
  try {
    for (const count of [0, 1, 4, 5, 7, 12, 13]) {
      projects = Array.from({ length: count }, (_, index) => ({ ...seed[index % seed.length], id: String(index), slug: `fixture-${index}` }));
      await visual.goto(origin + base + 'projetos/');
      if (count) await visual.locator('.project').first().waitFor();
      else await visual.getByText('Novos trabalhos chegam em breve.').waitFor();
      assert.equal(await visual.locator('.project').count(), count);
      assert.equal(await visual.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `grid overflow for ${count} projects`);
      const boxes = await visual.locator('.project').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, height: rect.height }; }));
      for (let i = 0; i < boxes.length; i++) {
        assert.ok(boxes[i].height > 100, `project ${i} has a usable cover at count ${count}`);
        for (let j = 0; j < i; j++) assert.ok(boxes[i].right <= boxes[j].x || boxes[j].right <= boxes[i].x || boxes[i].bottom <= boxes[j].y || boxes[j].bottom <= boxes[i].y, 'project cards never overlap');
      }
    }
  } finally { projects = originalProjects; }
  await visual.goto(origin + base + 'projetos/');
  await visual.locator('.project').first().waitFor();
  const firstCard = visual.locator('.project').first();
  await firstCard.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await visual.mouse.move(0, 0);
  const staticCover = await firstCard.screenshot();
  await firstCard.hover();
  assert.deepEqual(await firstCard.screenshot(), staticCover, 'covers and captions remain pixel-identical on hover');
  await visual.emulateMedia({ reducedMotion: 'reduce' });
  const menuLink = visual.getByRole('link', { name: 'Sobre', exact: true });
  await menuLink.focus();
  assert.equal(await visual.locator('.nav-highlight').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await visual.close();

  // Exercise public navigation and touch layouts at narrow phone widths.
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.route(api + '/**', fixture);
  const mobile = await touch.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 430]) {
    await mobile.setViewportSize({ width, height: 844 });
    await mobile.goto(origin + base);
    await mobile.getByRole('heading', { name: 'Camylle Teske', exact: true }).waitFor();
    assert.equal(await mobile.locator('.project').count(), 0, 'cover is separate from the projects');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `cover overflow ${width}`);
    if (await mobile.locator('.privacy-banner').isVisible()) await mobile.getByRole('button', { name: 'Recusar', exact: true }).click();
    if (width === 390) await mobile.screenshot({ path: 'test-results/cover-mobile.png', fullPage: true });
    await mobile.getByRole('link', { name: 'Projetos', exact: true }).click();
    await mobile.locator('.project').first().waitFor();
    if (await mobile.locator('.privacy-banner').isVisible()) await mobile.getByRole('button', { name: 'Recusar', exact: true }).click();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`);
    assert.equal(await mobile.locator('.project-caption').first().evaluate(node => getComputedStyle(node).opacity), '1', 'touch cards keep captions visible');
    for (const nav of await mobile.locator('nav a').all()) assert.ok((await nav.boundingBox()).height >= 44, 'menu touch target');
    await mobile.getByRole('link', { name: 'Sobre', exact: true }).click();
    await mobile.getByRole('heading', { name: 'Sobre Mim', exact: true }).waitFor();
    assert.equal(await mobile.locator('nav a[aria-current="page"]').textContent(), 'Sobre');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) await mobile.screenshot({ path: 'test-results/about-mobile.png', fullPage: true });
    await mobile.getByRole('link', { name: 'Contato', exact: true }).click();
    await mobile.getByRole('heading', { name: 'Vamos conversar?', exact: true }).waitFor();
    assert.equal(await mobile.locator('.email-link').getAttribute('href'), 'mailto:teske.camy@gmail.com');
    assert.equal(await mobile.locator('.contact-socials a[href="https://www.instagram.com/camyteske/"]').count(), 1);
    assert.equal(await mobile.locator('a[href="https://www.linkedin.com/in/camylle-teske-62a539330/"]').count(), 1);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) await mobile.screenshot({ path: 'test-results/contact-mobile.png', fullPage: true });
    await mobile.getByRole('link', { name: 'Projetos', exact: true }).click();
    await mobile.locator('.project').first().waitFor();
    if (await mobile.locator('.privacy-banner').isVisible()) await mobile.getByRole('button', { name: 'Recusar', exact: true }).click();
    if (width === 390) await mobile.screenshot({ path: 'test-results/portfolio-mobile.png', fullPage: true });
    await mobile.locator('.project').first().tap();
    await mobile.locator('.project-detail').waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await touch.close();

  // Consent is independent of login. Only an explicit acceptance emits a count.
  const consentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await consentContext.route(api + '/**', fixture);
  const consentPage = await consentContext.newPage();
  consentPage.on('pageerror', error => errors.push(error.message));
  const beforeConsent = analyticsEvents.length;
  await consentPage.goto(origin + base + 'sobre/?email=must-not-be-sent#private-fragment');
  const banner = consentPage.locator('.privacy-banner');
  await banner.waitFor({ state: 'visible' });
  assert.equal(analyticsEvents.length, beforeConsent);
  const accept = await banner.getByRole('button', { name: 'Aceitar estatísticas', exact: true }).boundingBox();
  const refuse = await banner.getByRole('button', { name: 'Recusar', exact: true }).boundingBox();
  assert.ok(accept.height >= 44 && refuse.height >= 44 && Math.abs(accept.width - refuse.width) < 1);
  await consentPage.screenshot({ path: 'test-results/consent-mobile.png' });
  await banner.getByRole('button', { name: 'Aceitar estatísticas', exact: true }).click();
  for (let i = 0; analyticsEvents.length === beforeConsent && i < 50; i++) await consentPage.waitForTimeout(50);
  assert.equal(analyticsEvents.length, beforeConsent + 1);
  assert.deepEqual(analyticsEvents.at(-1).body, { path: '/sobre/', consent: 'statistics-v1' });
  for (const header of ['authorization', 'cookie', 'referer']) assert.equal(analyticsEvents.at(-1).headers[header], undefined);
  await consentPage.reload();
  await consentPage.getByRole('heading', { name: 'Sobre Mim', exact: true }).waitFor();
  for (let i = 0; analyticsEvents.length < beforeConsent + 2 && i < 50; i++) await consentPage.waitForTimeout(50);
  assert.equal(analyticsEvents.length, beforeConsent + 2);
  assert.equal(await banner.isVisible(), false);
  await consentPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(analyticsEvents.length, beforeConsent + 2);
  await consentPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  for (let i = 0; analyticsEvents.length < beforeConsent + 3 && i < 50; i++) await consentPage.waitForTimeout(50);
  assert.equal(analyticsEvents.length, beforeConsent + 3);
  await consentPage.getByRole('button', { name: 'Preferências de privacidade', exact: true }).click();
  await consentPage.getByRole('dialog').getByRole('button', { name: 'Recusar', exact: true }).click();
  const afterRefusal = analyticsEvents.length;
  await consentPage.goto(origin + base + 'contato/');
  await consentPage.getByRole('heading', { name: 'Vamos conversar?', exact: true }).waitFor();
  assert.equal(await banner.isVisible(), false); assert.equal(analyticsEvents.length, afterRefusal);
  assert.deepEqual(await consentPage.evaluate(() => Object.keys(localStorage)), ['camy-statistics-consent-v1']);
  assert.deepEqual(await consentContext.cookies(), []);
  // Changing the choice in another tab affects the open page as well.
  const consentOther = await consentContext.newPage(); await consentOther.goto(origin + base + 'privacidade/');
  await consentOther.getByRole('button', { name: 'Preferências de privacidade', exact: true }).click();
  await consentOther.getByRole('dialog').getByRole('button', { name: 'Aceitar estatísticas', exact: true }).click();
  await consentPage.waitForFunction(() => localStorage.getItem('camy-statistics-consent-v1') === 'accepted');
  await consentPage.getByRole('button', { name: 'Preferências de privacidade', exact: true }).click();
  await consentPage.getByText('Sua escolha atual: estatísticas permitidas.', { exact: false }).waitFor();
  await consentPage.getByRole('dialog').getByRole('button', { name: 'Recusar', exact: true }).click();
  await consentOther.waitForFunction(() => document.querySelector('[data-privacy-current]').textContent.includes('recusadas'));
  await consentContext.close();
  const blockedStorage = await browser.newContext({ viewport: { width: 320, height: 844 } });
  await blockedStorage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  await blockedStorage.route(api + '/**', fixture);
  const blockedPage = await blockedStorage.newPage(); blockedPage.on('pageerror', error => errors.push(error.message));
  await blockedPage.goto(origin + base + 'contato/');
  await blockedPage.getByRole('button', { name: 'Recusar', exact: true }).click();
  assert.equal(await blockedPage.locator('.privacy-banner').isVisible(), false);
  await blockedPage.getByRole('link', { name: 'Sobre', exact: true }).click();
  await blockedPage.getByRole('heading', { name: 'Sobre Mim', exact: true }).waitFor();
  await blockedStorage.close();

  // A production HTTP origin must not expose a login form or restore a session.
  const insecure = await browser.newContext();
  let insecureAPIRequests = 0;
  await insecure.route(api + '/**', route => { insecureAPIRequests++; return route.abort(); });
  await insecure.route('http://portfolio.test/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(base.length);
    const file = join(fixtureBuild, path.endsWith('/') ? path + 'index.html' : path || 'index.html');
    assert.ok(file.startsWith(fixtureBuild + '/'));
    const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }[extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: await readFile(file) });
  });
  const insecurePage = await insecure.newPage();
  insecurePage.on('pageerror', error => errors.push(error.message));
  await insecurePage.goto('http://portfolio.test' + base + 'admin/?senha=alterar#access_token=fixture');
  await insecurePage.locator('a[href^="https://portfolio.test"]').waitFor();
  assert.equal(await insecurePage.locator('input[type="password"]').count(), 0);
  assert.equal(await insecurePage.locator('input[type="email"]').count(), 0);
  assert.equal(insecureAPIRequests, 0);
  assert.equal(await insecurePage.locator('a[href^="https://portfolio.test"]').getAttribute('href'), 'https://portfolio.test' + base + 'admin/?senha=alterar#access_token=fixture');
  await insecure.close();
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(requests.some(r => r.startsWith('POST /storage/v1/object/portfolio/')));
  console.log(`Browser OK (${base}): bundle de produção/CSP, HTTPS, login, recuperação, ordem, upload, rascunho, publicação, menus/contato, mobile 320/390/430, exclusão e saída entre abas.`);
} finally { await browser?.close(); server?.kill('SIGTERM'); await rm(fixtureDirectory, { recursive: true, force: true }); restorePages(); }
