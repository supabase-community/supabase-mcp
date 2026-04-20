type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const HIGH_RISK_PATTERNS: Array<{ method: HttpMethod | 'ANY'; pattern: RegExp }> = [
  // SQL query endpoint — same backend as execute_sql
  { method: 'POST', pattern: /^\/v1\/projects\/[^/]+\/database\/query/ },
  // Logs — contain HTTP request bodies, auth events, Edge Function stdout from end-users
  { method: 'GET', pattern: /^\/v1\/projects\/[^/]+\/analytics\/endpoints\/logs/ },
  // Edge Function source — arbitrary text, could contain injected instructions in comments
  { method: 'GET', pattern: /^\/v1\/projects\/[^/]+\/functions\/[^/]+\/body/ },
  // SQL snippet detail — content.sql is free text any org member can write
  { method: 'GET', pattern: /^\/v1\/snippets\/[^/]+$/ },
];

export function requiresBoundary(method: string, path: string): boolean {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  const pathOnly = normalised.split('?')[0] ?? normalised;
  return HIGH_RISK_PATTERNS.some(
    (rule) => (rule.method === 'ANY' || rule.method === method) && rule.pattern.test(pathOnly)
  );
}
