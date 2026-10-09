// Contrato HTTP de teste. Nunca é incluído no site publicado.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:4179';
const api = 'https://camylle-test.supabase.co';
const base = process.env.TEST_BASE_PATH || '/';
const seed = JSON.parse(await readFile(new URL('../src/initial-projects.json', import.meta.url), 'utf8'));
let projects = structuredClone(seed);
const upload = await readFile(new URL('../public/images/vestis.png', import.meta.url));
const requests = [];
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only', VITE_BASE_PATH: base },
});
let serverOutput = ''; server.stdout.on('data', data => serverOutput += data); server.stderr.on('data', data => serverOutput += data);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(origin + base); if (response.ok) break; } catch { /* Ainda iniciando. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/auth/v1/recover') return json({});
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname === '/rest/v1/rpc/portfolio_access') return json(true);
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
  await page.goto(origin + base + 'admin/');
  await page.getByLabel('E-mail', { exact: true }).fill(user.email);
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
  await publicPage.goto(origin + base);
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
  await publicPage.goto(origin + base);
  await publicPage.getByText('Não foi possível carregar os trabalhos agora.').waitFor();
  assert.equal(await publicPage.locator('.project').count(), 0);
  await publicPage.unroute(api + '/rest/v1/projects**');
  await publicPage.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await publicPage.locator('.project').first().waitFor();
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
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(requests.some(r => r.startsWith('POST /storage/v1/object/portfolio/')));
  console.log(`Browser OK (${base}): login, ordem, upload, rascunho, persistência, publicação, página, falha de rede, mobile, exclusão e saída.`);
} finally { await browser.close(); server.kill('SIGTERM'); }
