import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111';
const outsider = '22222222-2222-4222-8222-222222222222';
const published = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to anon, authenticated;
`);
await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`
  insert into auth.users values ('${admin}'), ('${outsider}');
  insert into private.portfolio_admins values ('${admin}');
  insert into public.projects(id,slug,title,category,description,status,cover_path,media) values
    ('${published}','published','Publicado','Design','Descrição','published','${published}/cover.jpg','[{"path":"${published}/cover.jpg","alt":"Capa"}]'),
    ('${draft}','draft','Rascunho','','','draft','${draft}/cover.jpg','[{"path":"${draft}/cover.jpg","alt":"Capa"}]');
  insert into storage.objects(bucket_id,name) values
    ('portfolio','${published}/cover.jpg'),('portfolio','${draft}/cover.jpg'),('portfolio','${published}/unused.jpg'),('another','${published}/cover.jpg');
`);

async function asRole(role, id, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${id || ''}',false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

test('anonymous visitors only read published projects and referenced public media', async () => {
  await asRole('anon', null, async () => {
    assert.deepEqual((await db.query('select slug from public.projects')).rows.map(p => p.slug), ['published']);
    assert.deepEqual((await db.query('select name from storage.objects')).rows.map(p => p.name), [`${published}/cover.jpg`]);
    await assert.rejects(db.exec("insert into public.projects(slug,title) values ('hacked','Hacked')"));
    await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values ('portfolio','hacked.jpg')"));
  });
});
test('an authenticated non-admin gains no write or draft access and cannot self-authorize', async () => {
  await asRole('authenticated', outsider, async () => {
    assert.equal((await db.query('select public.portfolio_access() as allowed')).rows[0].allowed, false);
    assert.equal((await db.query('select count(*)::int as n from public.projects')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n, 1);
    await assert.rejects(db.exec("insert into public.projects(slug,title) values ('hacked','Hacked')"));
    await assert.rejects(db.exec(`insert into private.portfolio_admins values ('${outsider}')`));
    await assert.rejects(db.exec(`select public.reorder_projects(array['${draft}'::uuid,'${published}'::uuid])`));
    await db.exec("update public.projects set title='Changed'");
    await db.exec('delete from public.projects');
  });
  assert.equal((await db.query('select count(*)::int as n from public.projects')).rows[0].n, 2);
  assert.equal((await db.query(`select title from public.projects where id='${published}'`)).rows[0].title, 'Publicado');
});
test('admin allowlist remains protected by RLS even if client table grants are accidentally added', async () => {
  await db.exec('grant select, insert, update, delete on private.portfolio_admins to anon, authenticated');
  try {
    for (const [role, id] of [['anon', null], ['authenticated', outsider]]) {
      await asRole(role, id, async () => {
        assert.equal((await db.query('select count(*)::int as n from private.portfolio_admins')).rows[0].n, 0);
        await assert.rejects(db.exec(`insert into private.portfolio_admins values ('${outsider}')`));
        await db.exec('delete from private.portfolio_admins');
      });
    }
    await asRole('authenticated', admin, async () => {
      assert.equal((await db.query('select public.portfolio_access() as allowed')).rows[0].allowed, true);
    });
    assert.equal((await db.query('select count(*)::int as n from private.portfolio_admins')).rows[0].n, 1);
  } finally {
    await db.exec('revoke all on private.portfolio_admins from anon, authenticated');
  }
});
test('admin can create drafts, publish, edit, reorder, unpublish and delete', async () => {
  await asRole('authenticated', admin, async () => {
    assert.equal((await db.query('select public.portfolio_access() as allowed')).rows[0].allowed, true);
    assert.equal((await db.query('select count(*)::int as n from public.projects')).rows[0].n, 2);
    assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n, 3);
    await db.exec(`update public.projects set category='Design',description='Descrição',status='published' where id='${draft}'`);
    await db.exec(`select public.reorder_projects(array['${draft}'::uuid,'${published}'::uuid])`);
    assert.deepEqual((await db.query('select slug from public.projects order by position')).rows.map(p => p.slug), ['draft', 'published']);
    await assert.rejects(db.exec(`select public.reorder_projects(array['${draft}'::uuid,'${draft}'::uuid])`));
    await db.exec(`update public.projects set status='draft' where id='${draft}'`);
    await db.exec("insert into public.projects(slug,title) values ('new-project','Novo')");
    await db.exec("delete from public.projects where slug='new-project'");
    await db.exec(`insert into storage.objects(bucket_id,name) values ('portfolio','${draft}/new.png')`);
    await db.exec(`delete from storage.objects where name='${draft}/new.png'`);
    await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values ('another','wrong.jpg')"));
    await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values ('portfolio','${draft}/../../wrong.jpg')`));
    await assert.rejects(db.exec(`update public.projects set media='[{"path":"${published}/wrong.jpg","alt":""}]' where id='${draft}'`));
  });
  await asRole('anon', null, async () => assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n, 1));
});
