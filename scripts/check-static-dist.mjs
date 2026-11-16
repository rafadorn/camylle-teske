import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSnapshot } from '../src/publication.js';

const snapshot = validateSnapshot(JSON.parse(await readFile('dist/published/portfolio.json', 'utf8')));
const works = await readFile('dist/projetos/index.html', 'utf8');
assert.ok(works.includes('class="works-view'), 'project grid rendered before JavaScript');
assert.ok(!works.includes('Carregando trabalhos'), 'public work does not wait for the database');
let images = 0;
for (const project of snapshot.projects) {
  const html = await readFile(join('dist/projetos', project.slug, 'index.html'), 'utf8');
  assert.ok(html.includes('class="project-detail'), 'complete static project');
  assert.ok(!/src="https:\/\/[^\"]*supabase/.test(html), 'no remote project images');
  for (const media of project.media) { assert.ok((await stat(join('dist', media.local))).size > 0); images++; }
}
console.log(`Static publication OK: ${snapshot.projects.length} projects and ${images} referenced images, served locally without database queries.`);
