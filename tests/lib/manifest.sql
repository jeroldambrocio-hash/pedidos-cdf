-- Phase 6: what the database exposes for this app (cdf_*), in a form two databases can be compared by.
-- Read-only. Run on production (read-only SQL) and on the throwaway test database; compare the results.
select jsonb_build_object(
  'tables', (select jsonb_object_agg(c.relname, jsonb_build_object('rls', c.relrowsecurity,
      'cols', (select jsonb_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end order by a.attname)
               from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname like 'cdf\_%'),
  'policies', (select jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname, cmd || ' ' || array_to_string(roles, ','))
    from pg_policies where (schemaname = 'public' and tablename like 'cdf\_%') or (schemaname = 'storage' and policyname like 'cdf%')),
  'functions', (select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      jsonb_build_object('definer', p.prosecdef, 'config', coalesce(array_to_string(p.proconfig, ','), ''),
        'anon', has_function_privilege('anon', p.oid, 'execute'), 'authenticated', has_function_privilege('authenticated', p.oid, 'execute')))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'cdf\_%'),
  'table_grants', (select jsonb_object_agg(table_name || ':' || grantee, privs) from (
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name like 'cdf\_%' and grantee in ('anon', 'authenticated')
      group by 1, 2) g),
  'triggers', (select jsonb_agg(c.relname || '.' || t.tgname order by c.relname, t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public' and c.relname like 'cdf\_%'),
  'buckets', (select jsonb_agg(id order by id) from storage.buckets where id like 'cdf%'),
  'realtime', (select jsonb_agg(tablename order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'cdf\_%')
) as manifest
