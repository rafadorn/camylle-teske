import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { slugify, validateProject, validateImage, recordForSave } from '../src/project.js';
import { detail } from '../src/render.js';
import { validatePublicConfig, withProjectDefaults } from '../scripts/public-config.mjs';

const projects = JSON.parse(await readFile(new URL('../src/initial-projects.json', import.meta.url), 'utf8'));
test('portfolio preserves six projects and the exact Pace/Ígara sequence', () => {
  assert.equal(projects.length, 6);
  assert.deepEqual(projects[2].media.map(m => m.local), ['images/pace-01.jpeg', 'images/pace-03.jpeg', 'images/pace-02.jpeg']);
  assert.deepEqual(projects[3].media.map(m => m.local), ['images/igara.jpeg', 'images/psico-02.jpeg', 'images/psico-01.jpeg']);
  projects.forEach(p => assert.equal(validateProject(p), p));
});
test('publishing requires content, a cover and a complete triptych', () => {
  assert.throws(() => validateProject({ ...projects[0], cover_path: null }), /capa/);
  assert.throws(() => validateProject({ ...projects[0], cover_layout: 'triptych' }), /três/);
  assert.throws(() => validateProject({ ...projects[0], description: '' }), /descrição/);
  assert.doesNotThrow(() => validateProject({ ...projects[0], status: 'draft', category: '', description: '', media: [], cover_path: null }));
});
test('uploaded files must be supported images under the size limit', () => {
  assert.throws(() => validateImage({ name: 'x.html', type: 'text/html', size: 100 }), /JPG/);
  assert.throws(() => validateImage({ name: 'x.png', type: 'image/png', size: 9 * 1024 * 1024 }), /8 MB/);
});
test('build rejects secret credentials before any browser bundle is created', () => {
  assert.equal(validatePublicConfig({}), false);
  assert.equal(validatePublicConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' }), true);
  assert.throws(() => validatePublicConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co' }), /juntas/);
  assert.throws(() => validatePublicConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' }), /secretas/);
  const secret = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.throws(() => validatePublicConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: secret }), /service_role/);
});
test('project defaults configure the portfolio while overrides must provide both values', () => {
  const defaults = withProjectDefaults({ VITE_BASE_PATH: '/camylle-teske/' });
  assert.equal(defaults.VITE_SUPABASE_URL, 'https://wpkomwvtopxsbfmljdmz.supabase.co');
  assert.equal(defaults.VITE_BASE_PATH, '/camylle-teske/');
  assert.equal(validatePublicConfig(defaults), true);
  const partial = withProjectDefaults({ VITE_SUPABASE_URL: 'https://other.supabase.co' });
  assert.throws(() => validatePublicConfig(partial), /juntas/);
});
test('user text cannot inject HTML and saved records omit temporary data', () => {
  const p = { ...projects[0], title: '<img src=x onerror=alert(1)>', description: '</p><script>evil()</script>' };
  const html = detail(p);
  assert.ok(!html.includes('<script>evil'));
  assert.ok(html.includes('&lt;script&gt;'));
  const saved = recordForSave({ ...p, media: p.media.map(m => ({ ...m, url: 'blob:temporary', file: { secret: true } })) });
  assert.equal(saved.media[0].url, undefined);
  assert.equal(saved.media[0].local, undefined);
  assert.equal(slugify('Ígara Saúde — 2026'), 'igara-saude-2026');
});
