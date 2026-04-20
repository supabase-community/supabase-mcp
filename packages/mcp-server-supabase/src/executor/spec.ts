const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cached: unknown = null;
let cachedAt = 0;

export async function getSpec(specUrl = 'https://api.supabase.com/api/v1-json'): Promise<unknown> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  const res = await fetch(specUrl);
  if (!res.ok) throw new Error(`Failed to fetch Management API spec: ${res.status}`);
  cached = await res.json();
  cachedAt = Date.now();
  return cached;
}

export function invalidateSpec(): void {
  cached = null;
  cachedAt = 0;
}
