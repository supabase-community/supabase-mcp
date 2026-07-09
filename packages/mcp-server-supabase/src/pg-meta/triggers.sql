SELECT
  table_ns.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  function_ns.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace table_ns ON c.relnamespace = table_ns.oid
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_namespace function_ns ON p.pronamespace = function_ns.oid
WHERE NOT t.tgisinternal
