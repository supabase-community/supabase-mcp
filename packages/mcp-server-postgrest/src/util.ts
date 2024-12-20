/**
 * Ensures that a URL has a trailing slash.
 */
export function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Ensures that a URL does not have a trailing slash.
 */
export function ensureNoTrailingSlash(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
