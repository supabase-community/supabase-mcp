import { createHash } from 'node:crypto';

import type { InteractionStore, SecretStore } from './url-stores.js';

function digest(name: string): string {
  return createHash('sha256').update(JSON.stringify({ name })).digest('hex');
}

function session(req: Request): string | undefined {
  const cookie = req.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === 'poc_session') return decodeURIComponent(value.join('='));
  }
}

function response(body: string, status: number, contentType = 'text/plain') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': `${contentType}; charset=utf-8` },
  });
}

export function createConnectApp(opts: {
  interactions: InteractionStore;
  secrets: SecretStore;
  clock?: () => number;
}): { fetch(req: Request): Promise<Response> } {
  return {
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== '/connect') return response('Not found', 404);

      const principal = session(req);
      if (!principal)
        return response('A valid mock dashboard session is required.', 401);

      let id: string | null;
      let name: string | null = null;
      let secret: string | null = null;
      if (req.method === 'GET') {
        id = url.searchParams.get('i');
      } else if (req.method === 'POST') {
        const form = await req.formData();
        id = typeof form.get('i') === 'string' ? String(form.get('i')) : null;
        name =
          typeof form.get('name') === 'string'
            ? String(form.get('name'))
            : null;
        secret =
          typeof form.get('secret') === 'string'
            ? String(form.get('secret'))
            : null;
      } else {
        return response('Method not allowed', 405);
      }

      if (!id) return response('Interaction not found.', 404);
      const interaction = opts.interactions.get(id);
      if (!interaction)
        return response('Interaction not found or expired.', 404);
      if (principal !== interaction.principal) {
        return response('Session identity mismatch for this interaction.', 403);
      }

      if (req.method === 'GET') {
        return response(
          `<!doctype html><html><body><form method="post" action="/connect"><input type="hidden" name="i" value="${escapeHtml(id)}"><label>Key name <input name="name" required></label><label>API key <input name="secret" type="password" required></label><button type="submit">Store key</button></form></body></html>`,
          200,
          'text/html'
        );
      }

      if (!name || secret === null || digest(name) !== interaction.argsDigest) {
        return response('The key name does not match this interaction.', 400);
      }
      if (!opts.interactions.complete(id)) {
        return response('Interaction is expired or already complete.', 410);
      }
      opts.secrets.put(principal, name, secret);
      return response(
        'Your API key is stored. You can return to your client.',
        200
      );
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!
  );
}
