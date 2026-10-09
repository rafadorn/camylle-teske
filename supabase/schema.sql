-- Executar uma vez no SQL Editor de um projeto Supabase dedicado ao portfólio.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table if not exists private.portfolio_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.portfolio_admins enable row level security;
revoke all on private.portfolio_admins from public, anon, authenticated;

create or replace function private.is_portfolio_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.portfolio_admins where user_id = auth.uid());
$$;
revoke all on function private.is_portfolio_admin() from public;
grant execute on function private.is_portfolio_admin() to anon, authenticated;

create or replace function public.portfolio_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_portfolio_admin();
$$;
revoke all on function public.portfolio_access() from public;
grant execute on function public.portfolio_access() to authenticated;

create or replace function public.valid_portfolio_media(project_id uuid, images jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(images) <> 'array' or jsonb_array_length(images) > 40 then return false; end if;
  for item in select value from jsonb_array_elements(images) loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'path') is distinct from 'string'
      or coalesce(item->>'path', '') !~ ('^' || project_id::text || '/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$')
      or position('..' in (item->>'path')) > 0
      or jsonb_typeof(item->'alt') is distinct from 'string'
      or length(item->>'alt') > 600 then return false; end if;
  end loop;
  return true;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  title text not null check (length(trim(title)) between 1 and 160),
  category text not null default '' check (length(category) <= 160),
  description text not null default '' check (length(description) <= 12000),
  position integer not null default 1 check (position >= 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  cover_layout text not null default 'single' check (cover_layout in ('single', 'triptych')),
  cover_path text,
  media jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.valid_portfolio_media(id, media)),
  check (cover_path is null or media @> jsonb_build_array(jsonb_build_object('path', cover_path))),
  check (status <> 'published' or (
    cover_path is not null and length(trim(category)) > 0 and length(trim(description)) > 0
    and (cover_layout <> 'triptych' or jsonb_array_length(media) >= 3)
  ))
);

create index if not exists projects_public_order on public.projects(status, position, created_at);
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant select on public.projects to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;

drop policy if exists "Public reads published projects" on public.projects;
create policy "Public reads published projects" on public.projects
  for select to anon, authenticated using (status = 'published' or private.is_portfolio_admin());
drop policy if exists "Only portfolio admins manage projects" on public.projects;
create policy "Only portfolio admins manage projects" on public.projects
  for all to authenticated using (private.is_portfolio_admin()) with check (private.is_portfolio_admin());

create or replace function private.touch_project()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists portfolio_touch_project on public.projects;
create trigger portfolio_touch_project before update on public.projects
  for each row execute function private.touch_project();

-- Toda a reordenação é salva em uma única transação.
create or replace function public.reorder_projects(project_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_portfolio_admin() then raise insufficient_privilege using message = 'Only portfolio admins can reorder projects'; end if;
  if cardinality(project_ids) <> (select count(*) from public.projects)
    or cardinality(project_ids) <> (select count(distinct x) from unnest(project_ids) as x)
    or exists (select 1 from unnest(project_ids) as x where x is null or not exists (select 1 from public.projects where id = x))
    then raise exception 'The project list changed. Reload before reordering.'; end if;
  update public.projects p set position = item.ordinality
  from unnest(project_ids) with ordinality as item(id, ordinality) where p.id = item.id;
end;
$$;
revoke all on function public.reorder_projects(uuid[]) from public;
grant execute on function public.reorder_projects(uuid[]) to authenticated;

-- Bucket privado: rascunhos e arquivos não usados não podem ser lidos por visitantes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Read published portfolio images" on storage.objects;
create policy "Read published portfolio images" on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'portfolio' and (
      private.is_portfolio_admin() or exists (
        select 1 from public.projects p where p.status = 'published'
        and p.id::text = split_part(name, '/', 1)
        and p.media @> jsonb_build_array(jsonb_build_object('path', name))
      )
    )
  );
drop policy if exists "Admins upload portfolio images" on storage.objects;
create policy "Admins upload portfolio images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'portfolio' and private.is_portfolio_admin()
    and name ~ '^[0-9a-f-]{36}/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$' and position('..' in name) = 0
  );
drop policy if exists "Admins update portfolio images" on storage.objects;
create policy "Admins update portfolio images" on storage.objects
  for update to authenticated using (bucket_id = 'portfolio' and private.is_portfolio_admin())
  with check (bucket_id = 'portfolio' and private.is_portfolio_admin() and name ~ '^[0-9a-f-]{36}/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$' and position('..' in name) = 0);
drop policy if exists "Admins delete portfolio images" on storage.objects;
create policy "Admins delete portfolio images" on storage.objects
  for delete to authenticated using (bucket_id = 'portfolio' and private.is_portfolio_admin());

-- Após criar a conta da Camy em Authentication > Users, liberar pelo ID dela:
-- insert into private.portfolio_admins (user_id) values ('UUID-DA-CAMY');
