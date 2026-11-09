-- Extends the existing portfolio schema. No visitor records or identifiers.
create table private.portfolio_daily_views (
  view_day date not null,
  page_path text not null check (length(page_path) between 1 and 180),
  views bigint not null default 1 check (views > 0),
  primary key (view_day, page_path)
);
alter table private.portfolio_daily_views enable row level security;
revoke all on private.portfolio_daily_views from public, anon, authenticated;
grant select on private.portfolio_daily_views to authenticated;
grant select, insert, update, delete on private.portfolio_daily_views to service_role;
create policy "Portfolio admins read aggregate statistics"
  on private.portfolio_daily_views for select to authenticated
  using ((select private.is_portfolio_admin()));

-- A global minute budget, never a per-visitor or per-IP record.
create table private.portfolio_analytics_budget (
  minute timestamptz primary key,
  requests integer not null check (requests between 1 and 1200)
);
alter table private.portfolio_analytics_budget enable row level security;
revoke all on private.portfolio_analytics_budget from public, anon, authenticated;
grant select, insert, update, delete on private.portfolio_analytics_budget to service_role;
grant usage on schema private to service_role;

create function public.record_portfolio_page_view(page_path text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  requested_path text := page_path;
  today date := (current_timestamp at time zone 'America/Sao_Paulo')::date;
  used_count integer;
begin
  -- Authorized readiness probe: verifies the same RPC without creating a view.
  if requested_path is null then return true; end if;
  if length(requested_path) > 180 then
    raise invalid_parameter_value using message = 'Invalid public page';
  end if;
  if requested_path not in ('/', '/sobre/', '/contato/', '/privacidade/') then
    if requested_path !~ '^/projetos/[a-z0-9]+(-[a-z0-9]+)*/$'
      or not exists (select 1 from public.projects p where p.status = 'published'
        and p.slug = substring(requested_path from '^/projetos/(.*)/$')) then
      raise invalid_parameter_value using message = 'Invalid public page';
    end if;
  end if;

  insert into private.portfolio_analytics_budget as budget (minute, requests)
  values (date_trunc('minute', current_timestamp), 1)
  on conflict (minute) do update set requests = budget.requests + 1
    where budget.requests < 1200
  returning requests into used_count;
  if used_count is null then return false; end if;

  insert into private.portfolio_daily_views as stats (view_day, page_path, views)
  values (today, requested_path, 1)
  on conflict on constraint portfolio_daily_views_pkey
  do update set views = stats.views + 1;

  delete from private.portfolio_daily_views where view_day < today - 364;
  delete from private.portfolio_analytics_budget where minute < current_timestamp - interval '2 minutes';
  return true;
end;
$$;
revoke all on function public.record_portfolio_page_view(text) from public, anon, authenticated;
grant execute on function public.record_portfolio_page_view(text) to service_role;

create function public.portfolio_analytics(days integer default 90)
returns table (view_day date, page_path text, views bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_portfolio_admin() then
    raise insufficient_privilege using message = 'Only portfolio admins can read statistics';
  end if;
  if days is null or days < 1 or days > 365 then
    raise invalid_parameter_value using message = 'Invalid statistics period';
  end if;
  return query select s.view_day, s.page_path, s.views
  from private.portfolio_daily_views s
  where s.view_day between (current_timestamp at time zone 'America/Sao_Paulo')::date - days + 1
    and (current_timestamp at time zone 'America/Sao_Paulo')::date
  order by s.view_day desc, s.page_path;
end;
$$;
revoke all on function public.portfolio_analytics(integer) from public, anon;
grant execute on function public.portfolio_analytics(integer) to authenticated;
