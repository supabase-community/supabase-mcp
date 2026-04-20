export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiClient {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  put(path: string, body?: unknown): Promise<unknown>;
  patch(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
}

export interface ApiClientOptions {
  // Called after each successful request — used to track which endpoints were hit.
  onRequest?: (method: HttpMethod, path: string) => void;
}

export function createApiClient(
  token: string,
  apiUrl: string,
  options: ApiClientOptions = {}
): ApiClient {
  const { onRequest } = options;
  const base = new URL(apiUrl.replace(/\/$/, ''));

  async function request(
    method: HttpMethod,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    // Reject scheme-relative paths (e.g. "//evil.com/x") before URL parsing —
    // without this, new URL() would treat the next segment as a hostname and
    // the origin check below could be bypassed with a lookalike prefix.
    if (path.startsWith('//')) {
      throw new Error(`Only requests to ${base.origin} are permitted`);
    }

    const url = new URL(path.startsWith('/') ? path : `/${path}`, base);

    // Origin check (not string prefix) — prevents SSRF via lookalike hostnames.
    if (url.origin !== base.origin) {
      throw new Error(`Only requests to ${base.origin} are permitted`);
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }

    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('application/json')
      ? await res.json()
      : await res.text();
    onRequest?.(method, path);
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}
