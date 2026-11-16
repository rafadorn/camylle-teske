import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { publishedRecords, publicationVersion, validateSnapshot } from '../src/publication.js';
import { exportPublished, refreshPublished, verifyDirectory, limitedBytes, MAX_JSON_BYTES } from '../scripts/published-content.mjs';
import { unpackSnapshot, archiveEntries, saveCache, restoreCache, cleanCache, publicationNeeded } from '../scripts/published-cache.mjs';
import { fixtureProjects, fixtureAssets, writeFixture } from './publication-fixture.mjs';

const url = 'https://fixture.supabase.co', key = 'sb_publishable_fixture';
const draft = { ...structuredClone(fixtureProjects[0]), slug: 'private-draft', status: 'draft', description: 'DRAFT_MUST_NOT_APPEAR' };

function sourceFixture({ projects = fixtureProjects, transformSign = x => x, afterDownload } = {}) {
  const calls = [];
  const fetcher = async (address, options = {}) => {
    const target = new URL(address);
    calls.push({ address: target, options });
    assert.equal(target.origin, url);
    if (target.pathname === '/rest/v1/projects') {
      assert.equal(target.searchParams.get('status'), 'eq.published');
      assert.ok(!target.searchParams.get('select').includes('*'));
      return Response.json(typeof projects === 'function' ? projects() : projects);
    }
    if (target.pathname === '/storage/v1/object/sign/portfolio') {
      const paths = JSON.parse(options.body).paths;
      return Response.json(transformSign(paths.map(path => ({ path, signedURL: '/object/sign/portfolio/' + path + '?token=SIGNED_TOKEN_NEVER_EXPORT' }))));
    }
    const path = target.pathname.replace('/storage/v1/object/sign/portfolio/', '');
    assert.equal(options.headers, undefined, 'no API credentials forwarded with image downloads');
    afterDownload?.();
    return new Response(fixtureAssets.get(path).bytes);
  };
  return { fetcher, calls };
}

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'publication-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('public projection excludes drafts, sessions, extra columns, file objects and signed URLs', async () => {
  const projects = [...fixtureProjects.map(project => ({ ...project, internal_notes: 'INTERNAL_NEVER_EXPORT', account: 'ACCOUNT_NEVER_EXPORT', media: project.media.map(media => ({ ...media, url: 'SIGNED_NEVER_EXPORT', file: 'FILE_NEVER_EXPORT' })) })), draft];
  const json = JSON.stringify(publishedRecords(projects));
  for (const forbidden of ['DRAFT_MUST_NOT_APPEAR','INTERNAL_NEVER_EXPORT','ACCOUNT_NEVER_EXPORT','SIGNED_NEVER_EXPORT','FILE_NEVER_EXPORT','created_at','"id"','"local"']) assert.ok(!json.includes(forbidden), forbidden);
  assert.equal(await publicationVersion(projects), await publicationVersion(fixtureProjects));
  const changed = structuredClone(fixtureProjects); changed[0].media[0].width = 'half';
  assert.notEqual(await publicationVersion(changed), await publicationVersion(fixtureProjects));
});

test('export copies real image bytes, preserves layouts, and creates a fully local publication', async t => {
  const root = await temp(t), directory = join(root,'published');
  const data = structuredClone(fixtureProjects);
  data[0].card_layout = 'wide'; data[0].media[0].width = 'half'; data[0].media[0].align = 'right';
  const fixture = sourceFixture({ projects: data });
  const { snapshot } = await exportPublished({ url, key, directory, fetcher: fixture.fetcher });
  assert.equal(snapshot.projects.length, data.length);
  assert.equal(snapshot.projects[0].card_layout, 'wide');
  assert.equal(snapshot.projects[0].media[0].align, 'right');
  assert.deepEqual(await verifyDirectory(directory), snapshot);
  const json = JSON.stringify(snapshot);
  for (const forbidden of ['SIGNED_TOKEN_NEVER_EXPORT','supabase.co','https:','8b64b72b-733f','images/odara.jpeg']) assert.ok(!json.includes(forbidden));
  assert.equal(fixture.calls.filter(call => call.address.pathname === '/rest/v1/projects').length, 2, 'source rechecked after downloading');
  await assert.rejects(() => exportPublished({ url, key, directory: join(root,'bad'), fetcher: sourceFixture({ transformSign: items => items.map(item => ({ ...item, signedURL: 'https://evil.test/file' })) }).fetcher }), /Endereço/);
});

test('an unavailable source or partial download preserves the previous publication byte for byte', async t => {
  const root = await temp(t); await writeFixture(root);
  const directory = join(root,'published');
  const before = await readFile(join(directory,'portfolio.json'));
  const unavailable = await refreshPublished({ url, key, directory, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(unavailable.backendAvailable, false);
  assert.deepEqual(await readFile(join(directory,'portfolio.json')), before);
  const changed = structuredClone(fixtureProjects); changed[0].description += ' change';
  const fixture = sourceFixture({ projects: changed });
  const failImage = async (address, options) => String(address).includes('/object/sign/portfolio/') ? new Response('unavailable', { status:503 }) : fixture.fetcher(address,options);
  assert.equal((await refreshPublished({ url, key, directory, fetcher: failImage })).backendAvailable, false);
  assert.deepEqual(await readFile(join(directory,'portfolio.json')), before);
  await assert.rejects(() => refreshPublished({ url, key, directory: join(root,'missing'), fetcher: async () => { throw new Error('offline'); } }));
});

test('a withdrawal during export cannot publish stale content, and an authoritative empty list clears all work', async t => {
  const root = await temp(t); await writeFixture(root);
  const directory = join(root,'published');
  const before = await readFile(join(directory,'portfolio.json'));
  const changed = structuredClone(fixtureProjects); changed[0].description += ' change';
  let active = true;
  const fixture = sourceFixture({ projects: () => active ? changed : [], afterDownload: () => { active = false; } });
  assert.equal((await refreshPublished({ url, key, directory, fetcher: fixture.fetcher })).backendAvailable, false);
  assert.deepEqual(await readFile(join(directory,'portfolio.json')), before);
  const result = await exportPublished({ url, key, directory, fetcher: sourceFixture({ projects: [] }).fetcher });
  assert.deepEqual(result.snapshot.projects, []);
  assert.deepEqual(await readdir(join(directory,'media')), []);
});

test('invalid public manifests and image responses fail closed', async t => {
  const root = await temp(t); const snapshot = await writeFixture(root);
  for (const change of [value => value.projects.push(draft), value => { value.projects[0].media[0].url = 'https://evil.test'; }, value => { value.projects[0].media[0].path = '../../private'; }, value => { value.session = 'secret'; }]) {
    const bad = structuredClone(snapshot); change(bad); assert.throws(() => validateSnapshot(bad));
  }
  assert.throws(() => publishedRecords([{...fixtureProjects[0],media:[{path:'../secret',alt:''}]}]));
  await assert.rejects(() => limitedBytes(new Response('x', { headers: { 'content-length': String(MAX_JSON_BYTES + 1) } }), MAX_JSON_BYTES), /limite/);
  const fixture = sourceFixture();
  const htmlImage = async (address, options) => String(address).includes('/object/sign/portfolio/') ? new Response('<html>evil</html>',{headers:{'content-type':'image/jpeg'}}) : fixture.fetcher(address, options);
  await assert.rejects(() => exportPublished({ url, key, directory: join(root,'bad'), fetcher: htmlImage }), /JPG/);
});

test('durable archives restore only a verified snapshot and reject symlinks or unexpected files', async t => {
  const root = await temp(t); await writeFixture(root);
  const directory = join(root,'published'), archive = join(root,'good.tar.gz');
  execFileSync('tar',['-czf',archive,'-C',directory,'portfolio.json','status.json','media']);
  await unpackSnapshot(archive, join(root,'restored'));
  assert.deepEqual(await readFile(join(root,'restored/portfolio.json')), await readFile(join(directory,'portfolio.json')));
  await writeFile(join(directory,'secret.txt'),'must not archive');
  execFileSync('tar',['-czf',join(root,'extra.tar.gz'),'-C',directory,'portfolio.json','status.json','secret.txt','media']);
  assert.throws(() => archiveEntries(join(root,'extra.tar.gz')), /inválido/);
  await symlink('/etc/passwd',join(directory,'media', 'a'.repeat(64)+'.jpg'));
  execFileSync('tar',['-czf',join(root,'symlink.tar.gz'),'-C',directory,'portfolio.json','status.json','media']);
  assert.throws(() => archiveEntries(join(root,'symlink.tar.gz')), /Links/);
});

test('GitHub publication changes the archive pointer atomically and never forwards credentials to downloads', async t => {
  const root = await temp(t); await writeFixture(root);
  const directory = join(root,'published');
  let release, failUpload = false, nextId = 1;
  const uploads = new Map();
  const repository = 'fixture/portfolio', token = 'TOKEN_STAYS_IN_ACTIONS';
  const fetcher = async (address, options = {}) => {
    const url = new URL(address);
    if (url.hostname === 'github.com') {
      assert.equal(options.headers, undefined, 'download uses no token');
      return new Response(uploads.get(url.pathname.split('/').at(-1)));
    }
    assert.equal(options.headers.authorization, 'Bearer ' + token);
    if (url.hostname === 'uploads.github.com') {
      if (failUpload) return new Response('unavailable',{status:503});
      const name = url.searchParams.get('name');
      uploads.set(name,options.body);
      release.assets.push({id:nextId++,name,state:'uploaded',size:options.body.length,browser_download_url:`https://github.com/${repository}/releases/download/portfolio-published/${name}`});
      return Response.json({});
    }
    assert.equal(url.hostname,'api.github.com');
    if (url.pathname.endsWith('/releases/tags/portfolio-published')) return release ? Response.json(release) : new Response('',{status:404});
    if (options.method === 'POST') { release={id:1,assets:[],body:'{}',upload_url:`https://uploads.github.com/repos/${repository}/releases/1/assets{?name,label}`}; return Response.json(release); }
    if (options.method === 'PATCH') { release.body=JSON.parse(options.body).body;return Response.json(release); }
    if (options.method === 'DELETE') { release.assets=release.assets.filter(asset=>asset.id!==Number(url.pathname.split('/').at(-1)));return new Response(null,{status:204}); }
    throw new Error('Unexpected request');
  };
  const options = { repository, token, fetcher };
  await saveCache(directory,options);
  const firstPointer=release.body;
  const probeFetch=(address,options)=>new URL(address).hostname==='fixture.supabase.co'?sourceFixture().fetcher(address,options):fetcher(address,options);
  assert.equal(await publicationNeeded({eventName:'schedule',url,key,...options,fetcher:probeFetch}),false,'unchanged content skips deployment');
  assert.equal(await publicationNeeded({eventName:'push',url,key,...options,fetcher:()=>{throw new Error('must not fetch');}}),true,'source changes can deploy from a saved copy');
  assert.equal(await publicationNeeded({eventName:'schedule',url,key,...options,fetcher:(address,options)=>new URL(address).hostname==='fixture.supabase.co'?Promise.reject(new Error('paused')):fetcher(address,options)}),false,'paused backend does not replace the current site');
  await restoreCache(join(root,'restored'),options);
  assert.deepEqual(await readFile(join(root,'restored/portfolio.json')),await readFile(join(directory,'portfolio.json')));
  const updated=structuredClone(fixtureProjects);updated[0].description+=' updated';
  assert.equal(await publicationNeeded({eventName:'schedule',url,key,...options,fetcher:(address,options)=>new URL(address).hostname==='fixture.supabase.co'?sourceFixture({projects:updated}).fetcher(address,options):fetcher(address,options)}),true,'published edits trigger a new deployment');
  await exportPublished({url:'https://fixture.supabase.co',key,directory,fetcher:sourceFixture({projects:updated}).fetcher});
  failUpload=true;
  await assert.rejects(()=>saveCache(directory,options));
  assert.equal(release.body,firstPointer,'failed upload preserves current pointer');
  failUpload=false;await saveCache(directory,options);await cleanCache(options);
  assert.notEqual(release.body,firstPointer);
  assert.equal(release.assets.length,1,'superseded archives removed');
});
