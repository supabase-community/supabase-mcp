import type { RequestListener } from 'node:http';

// Bridge from the SDK's fetch-shaped handler to node:http. Bodies are buffered
// on both sides on purpose: under `legacy: 'stateless'` every response is
// request-scoped, so a workstation entry gains nothing from streaming, and
// this keeps the package free of `@modelcontextprotocol/node` and its `hono` peer.

export type FetchHandler = (
  request: Request,
  parsedBody: unknown
) => Promise<Response>;

function parseJson(body: Buffer | undefined): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body.toString());
  } catch {
    // Lenient on purpose: the SDK validates the real body.
    return undefined;
  }
}

export function toNodeListener(handle: FetchHandler): RequestListener {
  return async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        for (const v of Array.isArray(value) ? value : [value]) {
          if (v !== undefined) headers.append(key, v);
        }
      }

      const url = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? '127.0.0.1'}`
      );

      const controller = new AbortController();
      res.on('close', () => controller.abort());

      const response = await handle(
        new Request(url, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
        }),
        parseJson(body)
      );

      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        res.destroy();
      }
    }
  };
}
