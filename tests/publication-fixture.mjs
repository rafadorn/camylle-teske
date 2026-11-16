import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { makeSnapshot, snapshotStatus } from '../src/publication.js';
import { imageExtension } from '../scripts/published-content.mjs';

const seed = JSON.parse(await readFile(new URL('../src/initial-projects.json', import.meta.url), 'utf8'));
const assets = new Map();
for (const media of seed.flatMap(project => project.media)) {
  const bytes = await readFile(new URL('../public/' + media.local, import.meta.url));
  const name = 'published/media/' + createHash('sha256').update(bytes).digest('hex') + '.' + imageExtension(bytes);
  assets.set(media.path, { bytes, name });
}
const fallback = [...assets.values()].find(asset => asset.name.endsWith('.png'));

export async function fixtureSnapshot(projects = seed) {
  const paths = new Map(projects.filter(project => project.status === 'published').flatMap(project => project.media.map(media => [media.path, (assets.get(media.path) || fallback).name])));
  return makeSnapshot(projects, paths, '2026-11-16T12:00:00.000Z');
}

export async function writeFixture(directory, projects = seed) {
  const snapshot = await fixtureSnapshot(projects);
  await mkdir(join(directory, 'published/media'), { recursive: true });
  for (const asset of new Map([...assets.values()].map(asset => [asset.name, asset])).values()) await writeFile(join(directory, asset.name), asset.bytes);
  // Keep only media referenced by this particular fixture.
  const { readdir, rm } = await import('node:fs/promises');
  const referenced = new Set(snapshot.projects.flatMap(project => project.media.map(media => media.local.split('/').at(-1))));
  for (const name of await readdir(join(directory, 'published/media'))) if (!referenced.has(name)) await rm(join(directory, 'published/media', name));
  await writeFile(join(directory, 'published/portfolio.json'), JSON.stringify(snapshot));
  await writeFile(join(directory, 'published/status.json'), JSON.stringify(snapshotStatus(snapshot)));
  return snapshot;
}

export { seed as fixtureProjects, assets as fixtureAssets };
