-- Presentation metadata only. Existing work and images retain their layout.
alter table public.projects add column if not exists card_layout text not null default 'auto';
alter table public.projects add constraint projects_card_layout_valid check (card_layout in ('auto','small','wide','tall','feature','full'));

create or replace function public.valid_image_layout(images jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(images) is distinct from 'array' then return false; end if;
  for item in select value from jsonb_array_elements(images) loop
    if item ? 'width' and (jsonb_typeof(item->'width') is distinct from 'string' or item->>'width' not in ('full','half','third')) then return false; end if;
    if item ? 'align' and (jsonb_typeof(item->'align') is distinct from 'string' or item->>'align' not in ('auto','left','center','right')) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_image_layout(jsonb) from public;
grant execute on function public.valid_image_layout(jsonb) to anon, authenticated, service_role;
alter table public.projects add constraint projects_image_layout_valid check (public.valid_image_layout(media));

-- Save order and card sizes together. Stale tabs cannot overwrite a newer layout.
create or replace function public.save_portfolio_layout(project_ids uuid[], card_layouts text[], expected_versions timestamptz[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_portfolio_admin() then raise insufficient_privilege using message = 'Only portfolio admins can edit layouts'; end if;
  if project_ids is null or card_layouts is null or expected_versions is null
    or coalesce(array_ndims(project_ids), 1) <> 1 or coalesce(array_ndims(card_layouts), 1) <> 1 or coalesce(array_ndims(expected_versions), 1) <> 1
    or cardinality(project_ids) <> cardinality(card_layouts) or cardinality(project_ids) <> cardinality(expected_versions) then
    raise invalid_parameter_value using message = 'Invalid layout';
  end if;
  perform 1 from public.projects order by id for update;
  if cardinality(project_ids) <> (select count(*) from public.projects)
    or cardinality(project_ids) <> (select count(distinct x) from unnest(project_ids) x)
    or exists (select 1 from unnest(project_ids, card_layouts, expected_versions) as i(id, layout, version)
      left join public.projects p on p.id = i.id
      where i.id is null or p.id is null or i.version is null or p.updated_at is distinct from i.version) then
    raise serialization_failure using message = 'Portfolio changed. Reload before editing its layout.';
  end if;
  if exists (select 1 from unnest(card_layouts) as x where x is null or x not in ('auto','small','wide','tall','feature','full')) then
    raise invalid_parameter_value using message = 'Invalid card layout';
  end if;
  update public.projects p set position = i.ordinality, card_layout = i.layout
  from unnest(project_ids, card_layouts) with ordinality as i(id, layout, ordinality) where p.id = i.id;
end;
$$;
revoke all on function public.save_portfolio_layout(uuid[],text[],timestamptz[]) from public, anon;
grant execute on function public.save_portfolio_layout(uuid[],text[],timestamptz[]) to authenticated;
