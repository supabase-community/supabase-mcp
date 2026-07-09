SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  l.lanname AS language,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    ELSE 'VOLATILE'
  END AS volatility,
  p.prosecdef AS security_definer,
  obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
LEFT JOIN pg_depend d
  ON d.classid = 'pg_proc'::regclass
  AND d.objid = p.oid
  AND d.deptype = 'e'
WHERE p.prokind = 'f'
  AND d.objid IS NULL
