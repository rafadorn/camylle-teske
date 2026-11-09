-- Allow only the new public catalog path; retain invoker security and all restrictions.
create or replace function public.record_portfolio_page_view(page_path text)
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
  if requested_path not in ('/', '/projetos/', '/sobre/', '/contato/', '/privacidade/') then
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

