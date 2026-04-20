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
  const base = apiUrl.replace(/\/$/, '');

  async function request(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, base).toString();

    // Prevent SSRF — executor code must stay within the Management API.
    if (!url.startsWith(base)) {
      throw new Error(`Only requests to ${base} are permitted`);
    }

    const res = await fetch(url, {
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
    const data = ct.includes('application/json') ? await res.json() : await res.text();
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
