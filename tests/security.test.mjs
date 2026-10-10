import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111';
const outsider = '22222222-2222-4222-8222-222222222222';
const published = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const schemaSql = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const auditSql = await readFile(new URL('../supabase/security-check.sql', import.meta.url), 'utf8');

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
await db.exec(schemaSql);
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

async function runSecurityAudit() {
  const results = await db.exec(auditSql);
  const report = results.find(result => result.fields?.some(field => field.name === 'verificacao'));
  assert.ok(report, 'The audit must return one report');
  return report.rows;
}

test('production audit reports the expected configuration without content or account IDs and enforces read-only execution', async () => {
  const report = await runSecurityAudit();
  assert.ok(report.length > 20);
  assert.ok(report.every(row => ['OK', 'INFO'].includes(row.resultado)), JSON.stringify(report));
  assert.deepEqual(report.find(row => row.objeto === 'public.projects' && row.verificacao === 'contagem').detalhes,
    { total: 2, publicados: 1, rascunhos: 1 });
  assert.equal(report.find(row => row.objeto === 'private.portfolio_admins' && row.verificacao === 'contagem').detalhes.total, 1);
  const output = JSON.stringify(report);
  for (const privateValue of [admin, outsider, published, draft, 'Publicado', 'Rascunho', 'Capa']) {
    assert.equal(output.includes(privateValue), false, `The report exposed fixture data: ${privateValue}`);
  }
  try {
    await assert.rejects(db.exec(auditSql.replace(/^rollback;$/m,
      "insert into public.projects(slug,title) values ('audit-must-not-write','Never save'); rollback;")), /read.only/i);
  } finally {
    await db.exec('rollback');
  }
  assert.equal((await db.query("select count(*)::int as n from public.projects where slug='audit-must-not-write'")).rows[0].n, 0);
});

test('production audit detects unsafe drift, missing and extra policies without repairing or exposing their expressions', async () => {
  const hiddenLiteral = 'audit-secret-only-in-definition';
  const extraPolicy = `Audit extra ${outsider}`;
  const validatorBody = (await db.query("select prosrc from pg_proc where oid='public.valid_portfolio_media(uuid,jsonb)'::regprocedure")).rows[0].prosrc;
  const changedValidator = validatorBody.replace('[a-zA-Z0-9_.-]', '[a-zA-Z 0-9_.-]');
  assert.notEqual(changedValidator, validatorBody);
  try {
    await db.exec(`
      create role audit_storage_owner;
      alter table storage.objects owner to audit_storage_owner;
      grant audit_storage_owner to anon;
      create role audit_definer_owner bypassrls;
      grant usage on schema private, auth to audit_definer_owner;
      alter function private.is_portfolio_admin() owner to audit_definer_owner;
      alter table public.projects disable row level security;
      alter table public.projects add column audit_only text;
      grant truncate on public.projects to public;
      grant select on private.portfolio_admins to authenticated;
      update storage.buckets set public=true, file_size_limit=null, allowed_mime_types=null where id='portfolio';
      alter policy "Public reads published projects" on public.projects using (true);
      drop policy "Admins delete portfolio images" on storage.objects;
      create policy "${extraPolicy}" on storage.objects for select to anon using (name <> '${hiddenLiteral}');
      alter policy "Admins upload portfolio images" on storage.objects with check (
        bucket_id = 'portfolio' and private.is_portfolio_admin()
        and name ~ '^[0-9a-f-]{36}/[a-zA-Z 0-9_.-]+\\.(jpg|jpeg|png|webp)$' and position('..' in name) = 0
      );
      alter function private.is_portfolio_admin() set search_path = public;
      create or replace function public.valid_portfolio_media(project_id uuid, images jsonb)
        returns boolean language plpgsql immutable set search_path = '' as $audit_body$${changedValidator}$audit_body$;
      create or replace function public.portfolio_access()
        returns boolean language sql stable security invoker set search_path = '' as $$
          select '${hiddenLiteral}' = 'other';
        $$;
      create function public.audit_extra_guard()
        returns boolean language sql security definer as $$ select true; $$;
    `);
    const report = await runSecurityAudit();
    const result = (type, object) => report.find(row => row.verificacao === type && row.objeto === object);
    assert.equal(result('rls', 'public.projects').resultado, 'DIVERGENTE');
    assert.equal(result('dono_tabela_cliente', 'storage.objects / anon').resultado, 'DIVERGENTE');
    assert.equal(result('estrutura_tabela', 'public.projects').resultado, 'REVISAR');
    assert.equal(result('privilegios_tabela', 'public.projects / anon').resultado, 'DIVERGENTE');
    assert.equal(result('privilegios_tabela', 'private.portfolio_admins / authenticated').resultado, 'DIVERGENTE');
    assert.equal(result('bucket', 'portfolio').resultado, 'DIVERGENTE');
    assert.equal(result('policy', 'public.projects / Public reads published projects').resultado, 'DIVERGENTE');
    assert.equal(result('policy', 'storage.objects / Admins delete portfolio images').resultado, 'AUSENTE');
    assert.equal(result('policy', 'storage.objects / Admins upload portfolio images').detalhes.expressoes_conferem, false);
    assert.equal(result('policy', 'storage.objects / Audit extra [ID oculto]').resultado, 'REVISAR');
    assert.equal(result('funcao', 'private.is_portfolio_admin()').detalhes.search_path_confere, false);
    assert.equal(result('funcao', 'private.is_portfolio_admin()').detalhes.definer_pode_ler_allowlist, false);
    assert.equal(result('funcao', 'public.portfolio_access()').detalhes.corpo_confere, false);
    assert.equal(result('funcao', 'public.valid_portfolio_media(uuid,jsonb)').detalhes.corpo_confere, false);
    assert.equal(result('funcao_definer_adicional', 'public.audit_extra_guard').resultado, 'REVISAR');
    assert.equal(JSON.stringify(report).includes(hiddenLiteral), false);
    assert.equal(JSON.stringify(report).includes(outsider), false);
    assert.equal((await db.query("select count(*)::int as n from pg_policies where policyname=$1", [extraPolicy])).rows[0].n, 1);
    assert.equal((await db.query("select public from storage.buckets where id='portfolio'")).rows[0].public, true);
  } finally {
    // Cleanup affects only this test's in-memory database, never a deployed project.
    await db.exec(`
      rollback;
      revoke audit_storage_owner from anon;
      alter table storage.objects owner to current_user;
      drop role audit_storage_owner;
      alter function private.is_portfolio_admin() owner to current_user;
      revoke usage on schema private, auth from audit_definer_owner;
      drop role audit_definer_owner;
      revoke truncate on public.projects from public;
      alter table public.projects drop column if exists audit_only;
      drop policy if exists "${extraPolicy}" on storage.objects;
      drop function if exists public.audit_extra_guard();
    `);
    await db.exec(schemaSql);
  }
  assert.ok((await runSecurityAudit()).every(row => ['OK', 'INFO'].includes(row.resultado)));
});
