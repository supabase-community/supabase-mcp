export async function canonicalObjectDigest(
  value: Record<string, unknown>,
  length?: number
): Promise<string> {
  const canonical = JSON.stringify(value, (_, nested) => {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return Object.keys(nested)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = (nested as Record<string, unknown>)[key];
          return result;
        }, {});
    }
    return nested;
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.slice(0, length);
}
