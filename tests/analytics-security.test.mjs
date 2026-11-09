import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111', outsider = '22222222-2222-4222-8222-222222222222';
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public,auth,storage to anon,authenticated,service_role;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
`);
await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`
  insert into auth.users values ('${admin}'),('${outsider}');
  insert into private.portfolio_admins values ('${admin}');
  insert into public.projects(id,slug,title,category,description,status,cover_path,media) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','published','Published','Design','A published project','published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover.jpg','[{"path":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover.jpg","alt":"Cover"}]'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','draft','Draft','','','draft',null,'[]');
  grant select on public.projects to service_role;
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261109120754_privacy_analytics.sql', import.meta.url), 'utf8'));
async function as(role, user, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${user || ''}',false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
test('only the collector role can increment totals, and it can never store arbitrary paths or draft slugs', async () => {
  await as('anon', null, async () => {
    await assert.rejects(db.exec("select public.record_portfolio_page_view('/')"));
    await assert.rejects(db.exec('select * from private.portfolio_daily_views'));
    await assert.rejects(db.exec('select * from public.portfolio_analytics(30)'));
  });
  await as('authenticated', outsider, async () => {
    await assert.rejects(db.exec("select public.record_portfolio_page_view('/')"));
    await assert.rejects(db.exec('select * from public.portfolio_analytics(30)'));
  });
  await as('service_role', null, async () => {
    for (const path of ['/', '/', '/sobre/', '/projetos/published/']) assert.equal((await db.query('select public.record_portfolio_page_view($1) as ok', [path])).rows[0].ok, true);
    for (const path of ['/admin/', '/projetos/draft/', '/projetos/unknown/', '/?email=private', 'https://evil.test']) await assert.rejects(db.query('select public.record_portfolio_page_view($1)', [path]));
  });
});
test('aggregate reads are private to the admin allowlist, with no visitor fields or direct writes', async () => {
  await as('authenticated', outsider, async () => assert.equal((await db.query('select * from private.portfolio_daily_views')).rows.length, 0));
  await as('authenticated', admin, async () => {
    const rows = (await db.query('select * from public.portfolio_analytics(30)')).rows;
    assert.equal(rows.length, 3); assert.equal(rows.reduce((n, r) => n + Number(r.views), 0), 4);
    assert.deepEqual(Object.keys(rows[0]), ['view_day', 'page_path', 'views']);
    await assert.rejects(db.exec("insert into private.portfolio_daily_views values(current_date,'/',99)"));
    await assert.rejects(db.exec('select * from public.portfolio_analytics(366)'));
  });
});
test('the collector caps global activity and expires old aggregate and budget rows', async () => {
  await db.exec("update private.portfolio_analytics_budget set requests=1200");
  await as('service_role', null, async () => assert.equal((await db.query("select public.record_portfolio_page_view('/') as ok")).rows[0].ok, false));
  await db.exec("delete from private.portfolio_analytics_budget; insert into private.portfolio_analytics_budget values(now()-interval '1 day',1); insert into private.portfolio_daily_views values((now() at time zone 'America/Sao_Paulo')::date-365,'/sobre/',1)");
  await as('service_role', null, async () => assert.equal((await db.query("select public.record_portfolio_page_view('/contato/') as ok")).rows[0].ok, true));
  assert.equal((await db.query('select count(*)::int as n from private.portfolio_analytics_budget')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from private.portfolio_daily_views')).rows[0].n, 4);
});
test('readiness probe creates neither views nor budget activity', async () => {
  const before = await db.query('select sum(views)::text as n from private.portfolio_daily_views');
  const budget = await db.query('select sum(requests)::int as n from private.portfolio_analytics_budget');
  await as('service_role', null, async () => assert.equal((await db.query('select public.record_portfolio_page_view(null) as ok')).rows[0].ok, true));
  assert.deepEqual(await db.query('select sum(views)::text as n from private.portfolio_daily_views'), before);
  assert.deepEqual(await db.query('select sum(requests)::int as n from private.portfolio_analytics_budget'), budget);
});
test.after(async () => db.close());
