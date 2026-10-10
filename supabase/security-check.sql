-- Auditoria somente leitura: executar no SQL Editor administrativo do Supabase,
-- depois de instalar schema.sql. Não altera tabelas, policies, contas ou arquivos.
-- Se projects/portfolio_admins não existirem, a consulta falha sem fazer mudanças:
-- isso indica que a instalação está incompleta ou que o projeto é outro.
--
-- OK: configuração coincide com este repositório. AUSENTE/DIVERGENTE: investigar.
-- REVISAR: policy/função adicional ou diferença que precisa de avaliação humana;
-- policies de outros buckets podem ser legítimas. Nenhuma é removida aqui.
-- INFO: contagens agregadas, sem conteúdo dos trabalhos nem IDs das contas;
-- só são completas quando contexto_leitura está OK (papel administrativo).
-- Não exibe corpos de funções ou expressões de policies: uma instalação alterada
-- pode conter dados sensíveis nesses textos. A comparação textual é conservadora;
-- diferenças de versão do Postgres podem exigir revisão mesmo sem vulnerabilidade.
-- Este relatório não verifica MFA, URLs de autenticação, limites de login ou TLS,
-- nem garante revogação de imagens públicas: o TTL assinado é escolhido no cliente.

begin transaction read only;
set local search_path = '';

with
client_roles as (
  select expected.name, r.oid, r.rolsuper, r.rolbypassrls
  from (values ('anon'), ('authenticated')) as expected(name)
  left join pg_catalog.pg_roles r on r.rolname = expected.name
),
target_tables as (
  select expected.name, c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity
  from (values ('public.projects'), ('private.portfolio_admins'), ('storage.objects')) as expected(name)
  left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass(expected.name)
),
table_shape as (
  select t.name, t.oid,
    (select md5(string_agg(pg_catalog.pg_get_constraintdef(c.oid, false),
      '|' order by c.contype, pg_catalog.pg_get_constraintdef(c.oid, false)))
      from pg_catalog.pg_constraint c where c.conrelid = t.oid) = e.constraints_hash as constraints_match,
    (select md5(string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text,
      '|' order by a.attnum)) from pg_catalog.pg_attribute a
      where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped) = e.columns_hash as columns_match
  from target_tables t join (values
    ('public.projects', 'a50835964626a8f713c5f4b3b27e41d7', 'b82f5477c8cdbee6a7de58e663e2892d'),
    ('private.portfolio_admins', 'c695ab624991a50da501f221713ecb58', '73c0aa9a292638f2933fc44927fd0f35')
  ) e(name, constraints_hash, columns_hash) on e.name = t.name
),
-- Hashes dos predicados canônicos com search_path vazio. Nenhum whitespace é
-- removido: espaços dentro de strings/regex também podem mudar as permissões.
expected_policies(table_name, policy_name, command, roles, using_hash, check_hash) as (
  values
    ('public.projects', 'Public reads published projects', 'r', array['anon', 'authenticated'],
      'f767c0bd9e66072f91fe59d61523542b', null),
    ('public.projects', 'Only portfolio admins manage projects', '*', array['authenticated'],
      '2c922b5ea483d4d352c0b801a9e62a24', '2c922b5ea483d4d352c0b801a9e62a24'),
    ('storage.objects', 'Read published portfolio images', 'r', array['anon', 'authenticated'],
      '57cc22201b7fdb9b71d775535cc934dc', null),
    ('storage.objects', 'Admins upload portfolio images', 'a', array['authenticated'], null,
      'e1d3847debb88f9ff69d826d20b719fa'),
    ('storage.objects', 'Admins update portfolio images', 'w', array['authenticated'],
      '08715fa1bb44e3f4365da53277de211d', 'e1d3847debb88f9ff69d826d20b719fa'),
    ('storage.objects', 'Admins delete portfolio images', 'd', array['authenticated'],
      '08715fa1bb44e3f4365da53277de211d', null)
),
actual_policies as (
  select t.name as table_name, p.polname::text as policy_name, p.polcmd::text as command,
    p.polpermissive as permissive,
    array(select case when role_id = 0 then 'public' else r.rolname::text end
      from unnest(p.polroles) role_id
      left join pg_catalog.pg_roles r on r.oid = role_id order by 1) as roles,
    md5(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)) as using_hash,
    md5(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)) as check_hash
  from pg_catalog.pg_policy p join target_tables t on t.oid = p.polrelid
),
policy_report as (
  select coalesce(e.table_name, a.table_name) as table_name,
    coalesce(e.policy_name, a.policy_name) as policy_name,
    e.policy_name is not null as expected, a.policy_name is not null as present,
    a.command, a.roles, a.permissive,
    (a.command = e.command and a.roles = e.roles and a.permissive) as structure_matches,
    (a.using_hash is not distinct from e.using_hash
      and a.check_hash is not distinct from e.check_hash) as expressions_match
  from expected_policies e full join actual_policies a
    on a.table_name = e.table_name and a.policy_name = e.policy_name
),
-- Hashes do prosrc bruto de schema.sql. Mudanças no SQL
-- precisam atualizar este baseline depois de revisão; hashes não são assinaturas.
expected_functions(signature, definer, volatility, public_execute, anon_execute, authenticated_execute, source_hash) as (
  values
    ('private.is_portfolio_admin()', true, 's', false, true, true, '6a03437f59a0c795bd9e9ba01abf18c1'),
    ('public.portfolio_access()', false, 's', false, false, true, 'e8e91343a489d07fbaf28a965b96b075'),
    ('public.valid_portfolio_media(uuid,jsonb)', false, 'i', true, true, true, '3952fcc0b892c1df417711aad52c2316'),
    ('private.touch_project()', false, 'v', true, true, true, 'abc24736eedbd3caddc31fa9ffa658a6'),
    ('public.reorder_projects(uuid[])', false, 'v', false, false, true, '2aeb9872d460201d8d03c224375126a8')
),
actual_functions as (
  select e.*, p.oid, p.prosecdef, p.provolatile::text as actual_volatility,
    p.proconfig = array['search_path=""'] as search_path_matches,
    md5(p.prosrc) = e.source_hash as source_matches,
    not exists (select 1 from client_roles r
      where pg_catalog.pg_has_role(r.oid, p.proowner, 'MEMBER')) as owner_not_client,
    case when e.definer then (
      select pg_catalog.has_table_privilege(p.proowner, t.oid, 'SELECT')
        and pg_catalog.has_schema_privilege(p.proowner, pg_catalog.to_regnamespace('private'), 'USAGE')
        and pg_catalog.has_schema_privilege(p.proowner, pg_catalog.to_regnamespace('auth'), 'USAGE')
        and pg_catalog.has_function_privilege(p.proowner, pg_catalog.to_regprocedure('auth.uid()'), 'EXECUTE')
        and (owner.rolsuper or owner.rolbypassrls or (
          pg_catalog.pg_has_role(p.proowner, t.relowner, 'USAGE') and not t.relforcerowsecurity))
      from pg_catalog.pg_roles owner cross join target_tables t
      where owner.oid = p.proowner and t.name = 'private.portfolio_admins')
      else true end as definer_can_read_admins,
    exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as actual_public_execute,
    pg_catalog.has_function_privilege((select oid from client_roles where name = 'anon'), p.oid, 'EXECUTE') as actual_anon_execute,
    pg_catalog.has_function_privilege((select oid from client_roles where name = 'authenticated'), p.oid, 'EXECUTE') as actual_authenticated_execute
  from expected_functions e left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(e.signature)
),
table_privileges as (
  select t.name as table_name, r.name as role_name, t.oid,
    array(select privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
      where pg_catalog.has_table_privilege(r.oid, t.oid, privilege) order by privilege) as privileges,
    case when t.name = 'private.portfolio_admins' then array[]::text[]
      when r.name = 'anon' then array['SELECT']
      else array['DELETE', 'INSERT', 'SELECT', 'UPDATE'] end as expected_privileges
  from target_tables t cross join client_roles r where t.name <> 'storage.objects'
),
project_counts as (
  select count(*) as total, count(*) filter (where status = 'published') as published,
    count(*) filter (where status = 'draft') as drafts from public.projects
),
admin_counts as (select count(*) as total from private.portfolio_admins),
report as (
  select 'contexto_leitura' as verificacao, 'SQL Editor administrativo' as objeto,
    case when r.rolsuper or r.rolbypassrls or not exists (
      select 1 from target_tables t where t.name <> 'storage.objects'
        and (not pg_catalog.pg_has_role(r.oid, t.relowner, 'USAGE') or t.relforcerowsecurity)
    ) then 'OK' else 'REVISAR' end as resultado,
    jsonb_build_object('observacao', 'Contagens dependem de um papel que possa ler todas as linhas; não é teste de acesso de visitante.') as detalhes
  from pg_catalog.pg_roles r where r.rolname = current_user
  union all
  select 'papel_cliente', name,
    case when oid is null then 'AUSENTE' when rolsuper or rolbypassrls then 'DIVERGENTE' else 'OK' end as resultado,
    jsonb_build_object('superuser', rolsuper, 'bypass_rls', rolbypassrls)
  from client_roles
  union all
  select 'rls', name,
    case when oid is null then 'AUSENTE' when relrowsecurity then 'OK' else 'DIVERGENTE' end,
    jsonb_build_object('ativo', relrowsecurity, 'force_rls', relforcerowsecurity)
  from target_tables
  union all
  select 'dono_tabela_cliente', t.name || ' / ' || r.name,
    case when t.oid is null or r.oid is null then 'AUSENTE'
      when pg_catalog.pg_has_role(r.oid, t.relowner, 'MEMBER') then 'DIVERGENTE' else 'OK' end,
    jsonb_build_object('pode_assumir_papel_dono', pg_catalog.pg_has_role(r.oid, t.relowner, 'MEMBER'),
      'herda_privilegios_dono', pg_catalog.pg_has_role(r.oid, t.relowner, 'USAGE'))
  from target_tables t cross join client_roles r
  union all
  select 'estrutura_tabela', name,
    case when oid is null then 'AUSENTE' when constraints_match and columns_match then 'OK' else 'REVISAR' end,
    jsonb_build_object('restricoes_conferem', constraints_match, 'colunas_conferem', columns_match,
      'observacao', 'CREATE TABLE IF NOT EXISTS não atualiza as restrições de uma tabela antiga.')
  from table_shape
  union all
  select 'privilegios_tabela', table_name || ' / ' || role_name,
    case when oid is null then 'AUSENTE' when privileges = expected_privileges then 'OK' else 'DIVERGENTE' end,
    jsonb_build_object('efetivos', privileges, 'esperados', expected_privileges)
  from table_privileges
  union all
  select 'privilegios_schema', 'private / ' || r.name,
    case when n.oid is null then 'AUSENTE'
      when pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE')
        and not pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') then 'OK' else 'DIVERGENTE' end,
    jsonb_build_object('usage', pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE'),
      'create', pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE'))
  from client_roles r left join pg_catalog.pg_namespace n on n.nspname = 'private'
  union all
  select 'bucket', 'portfolio',
    case when b.id is null then 'AUSENTE' when b.public = false and b.file_size_limit = 8388608
      and array(select mime from unnest(b.allowed_mime_types) mime order by mime) = array['image/jpeg', 'image/png', 'image/webp']
      then 'OK' else 'DIVERGENTE' end,
    jsonb_build_object('publico', b.public, 'limite_bytes', b.file_size_limit, 'tipos', b.allowed_mime_types)
  from (values ('portfolio')) expected(id) left join storage.buckets b on b.id = expected.id
  union all
  select 'policy', table_name || ' / ' || regexp_replace(policy_name,
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[ID oculto]', 'g'),
    case when not expected then 'REVISAR' when not present then 'AUSENTE'
      when structure_matches and expressions_match then 'OK' else 'DIVERGENTE' end,
    jsonb_build_object('esperada', expected, 'presente', present, 'comando',
      case command when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL' end,
      'papeis', roles, 'permissiva', permissive, 'estrutura_confere', structure_matches,
      'expressoes_conferem', case when expected and present then expressions_match else null end)
  from policy_report
  union all
  select 'funcao', signature,
    case when oid is null then 'AUSENTE'
      when prosecdef = definer and actual_volatility = volatility and search_path_matches and source_matches
        and owner_not_client and definer_can_read_admins
        and actual_public_execute = public_execute and actual_anon_execute = anon_execute
        and actual_authenticated_execute = authenticated_execute then 'OK' else 'DIVERGENTE' end,
    jsonb_build_object('security_definer', prosecdef, 'search_path_confere', search_path_matches,
      'corpo_confere', source_matches, 'volatilidade',
      case actual_volatility when 's' then 'stable' when 'i' then 'immutable' when 'v' then 'volatile' end,
      'dono_fora_dos_clientes', owner_not_client, 'definer_pode_ler_allowlist', definer_can_read_admins,
      'execute_public', actual_public_execute, 'execute_anon', actual_anon_execute,
      'execute_authenticated', actual_authenticated_execute)
  from actual_functions
  union all
  select 'funcao_definer_adicional', n.nspname || '.' || regexp_replace(p.proname::text,
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[ID oculto]', 'g'),
    'REVISAR', jsonb_build_object('security_definer', true,
      'search_path_vazio', coalesce(p.proconfig @> array['search_path=""'], false),
      'execute_anon', pg_catalog.has_function_privilege((select oid from client_roles where name = 'anon'), p.oid, 'EXECUTE'),
      'execute_authenticated', pg_catalog.has_function_privilege((select oid from client_roles where name = 'authenticated'), p.oid, 'EXECUTE'))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from actual_functions f where f.oid = p.oid)
  union all
  select 'contagem', 'public.projects', 'INFO',
    jsonb_build_object('total', total, 'publicados', published, 'rascunhos', drafts) from project_counts
  union all
  select 'contagem', 'private.portfolio_admins', case when total = 0 then 'REVISAR' else 'INFO' end,
    jsonb_build_object('total', total, 'observacao', 'Confirme no painel que todas as contas autorizadas são esperadas.') from admin_counts
)
select verificacao, objeto, resultado, detalhes from report
order by case when verificacao = 'contexto_leitura' then 0 else 1 end, verificacao, objeto;

rollback;
