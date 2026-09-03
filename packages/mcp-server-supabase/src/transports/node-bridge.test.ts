import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';

import { type FetchHandler, toNodeListener } from './node-bridge.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(handle: FetchHandler) {
  const server = createServer(toNodeListener(handle));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('toNodeListener', () => {
  test('round-trips a JSON request and response', async () => {
    let seen!: Request;
    let seenBody: unknown;
    const { origin } = await listen(async (request, parsedBody) => {
      seen = request;
      seenBody = parsedBody;
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json', 'x-test': 'yes' },
      });
    });

    const sent = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const response = await fetch(`${origin}/mcp?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sent),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('x-test')).toBe('yes');
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(seen.method).toBe('POST');
    expect(seen.headers.get('content-type')).toBe('application/json');
    expect(new URL(seen.url).pathname).toBe('/mcp');
    expect(new URL(seen.url).search).toBe('?x=1');
    expect(seenBody).toEqual(sent);
  });

  test('passes malformed JSON through with parsedBody undefined', async () => {
    const seen: Array<{ raw: string; parsed: unknown }> = [];
    const { origin } = await listen(async (request, parsedBody) => {
      seen.push({ raw: await request.text(), parsed: parsedBody });
      return new Response('passed', { status: 202 });
    });

    const malformed = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":',
    });
    expect(malformed.status).toBe(202);
    await expect(malformed.text()).resolves.toBe('passed');

    const plain = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(plain.status).toBe(202);

    expect(seen).toEqual([
      { raw: '{"jsonrpc":', parsed: undefined },
      { raw: 'hello', parsed: undefined },
    ]);
  });

  test('rejects request bodies larger than 4 MiB before calling the handler', async () => {
    let handled = false;
    const { origin } = await listen(async () => {
      handled = true;
      return new Response();
    });

    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(origin, { method: 'POST' }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        });
        req.on('error', reject);
        req.write(Buffer.alloc(4 * 1024 * 1024 + 1));
        req.end(Buffer.alloc(1024 * 1024));
      }
    );

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: 'payload too large',
    });
    expect(handled).toBe(false);
  });

  test('aborts the signal when the client drops mid-request and keeps serving', async () => {
    const handling = deferred();
    const release = deferred();
    let signal!: AbortSignal;
    let calls = 0;
    const { origin } = await listen(async (request) => {
      calls += 1;
      if (calls === 1) {
        signal = request.signal;
        handling.resolve();
        await release.promise;
      }
      return new Response(JSON.stringify({ call: calls }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const req = httpRequest(`${origin}/mcp`, { method: 'POST' });
    req.on('error', () => {});
    req.end('{}');
    await handling.promise;
    expect(signal.aborted).toBe(false);
    req.destroy();

    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    expect(signal.aborted).toBe(true);
    release.resolve();

    const next = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toEqual({ call: 2 });
  });
});
