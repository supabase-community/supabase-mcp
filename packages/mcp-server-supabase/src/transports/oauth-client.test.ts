import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse, passthrough } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createFileStore,
  createMemoryStore,
  fetchAuthorizationServerMetadata,
  login,
  logout,
  type OAuthStore,
  redirectUri,
} from './oauth-client.js';

// A fake authorization server only. No test here talks to a Supabase host.
const ISSUER = 'https://as.test';
const WELL_KNOWN = `${ISSUER}/.well-known/oauth-authorization-server`;
const EXPIRES_IN = 86400;

const metadata = (issuer: string) => ({
  issuer,
  authorization_endpoint: `${issuer}/v1/oauth/authorize`,
  token_endpoint: `${issuer}/v1/oauth/token`,
  registration_endpoint: `${issuer}/platform/oauth/apps/register`,
  code_challenge_methods_supported: ['S256', 'plain'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: [
    'client_secret_basic',
    'client_secret_post',
  ],
  response_types_supported: ['code'],
});

let mockServer!: SetupServer;
let callbackPort!: number;
let registerRequests!: unknown[];
let tokenRequests!: URLSearchParams[];
let revokeRequests!: URLSearchParams[];

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

beforeEach(async () => {
  callbackPort = await freePort();
  registerRequests = [];
  tokenRequests = [];
  revokeRequests = [];
  let issued = 0;
  mockServer = setupServer(
    http.get(WELL_KNOWN, () => HttpResponse.json(metadata(ISSUER))),
    http.post(`${ISSUER}/platform/oauth/apps/register`, async ({ request }) => {
      registerRequests.push(await request.json());
      return HttpResponse.json({
        client_id: 'client-1',
        client_secret: 'secret-1',
        client_secret_expires_at: 0,
        redirect_uris: [redirectUri(callbackPort)],
      });
    }),
    http.post(`${ISSUER}/v1/oauth/token`, async ({ request }) => {
      tokenRequests.push(new URLSearchParams(await request.text()));
      issued += 1;
      return HttpResponse.json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        expires_in: EXPIRES_IN,
        token_type: 'bearer',
      });
    }),
    http.post(`${ISSUER}/v1/oauth/revoke`, async ({ request }) => {
      revokeRequests.push(new URLSearchParams(await request.text()));
      return new HttpResponse(null, { status: 200 });
    }),
    // The loopback callback must reach the real socket.
    http.all(`http://127.0.0.1:${callbackPort}/*`, () => passthrough())
  );
  mockServer.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  vi.useRealTimers();
  mockServer.close();
});

/** Stands in for the browser: follows the authorize URL straight to the redirect with a code. */
function fakeBrowser(options: { state?: string } = {}) {
  const authorizeUrls: URL[] = [];
  const callbackStatuses: number[] = [];
  return {
    authorizeUrls,
    callbackStatuses,
    async open(url: string) {
      const authorize = new URL(url);
      authorizeUrls.push(authorize);
      const redirect = new URL(authorize.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('code', 'abc');
      redirect.searchParams.set(
        'state',
        options.state ?? authorize.searchParams.get('state')!
      );
      const response = await fetch(redirect);
      callbackStatuses.push(response.status);
    },
  };
}

function loginWith(store: OAuthStore, browser = fakeBrowser()) {
  return login({
    issuer: ISSUER,
    callbackPort,
    store,
    openBrowser: browser.open,
    log: () => {},
  });
}

function expireCurrentToken() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + EXPIRES_IN * 1000);
}

describe('login', () => {
  test('registers once, uses PKCE S256 without resource, and persists the client 0600', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-oauth-'));
    const dir = join(root, '.supabase');
    const path = join(dir, 'mcp-oauth.json');
    const browser = fakeBrowser();

    const source = await loginWith(createFileStore(path), browser);

    expect(registerRequests).toEqual([
      {
        client_name: 'supabase-mcp local http entry',
        redirect_uris: [redirectUri(callbackPort)],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      },
    ]);

    const [authorize] = browser.authorizeUrls;
    expect(authorize!.origin + authorize!.pathname).toBe(
      `${ISSUER}/v1/oauth/authorize`
    );
    expect(authorize!.searchParams.get('response_type')).toBe('code');
    expect(authorize!.searchParams.get('client_id')).toBe('client-1');
    expect(authorize!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize!.searchParams.has('resource')).toBe(false);
    expect(browser.callbackStatuses).toEqual([200]);

    const [exchange] = tokenRequests;
    expect(exchange!.get('grant_type')).toBe('authorization_code');
    expect(exchange!.get('code')).toBe('abc');
    expect(exchange!.get('redirect_uri')).toBe(redirectUri(callbackPort));
    expect(exchange!.get('client_id')).toBe('client-1');
    expect(exchange!.get('client_secret')).toBe('secret-1');
    expect(
      createHash('sha256')
        .update(exchange!.get('code_verifier')!)
        .digest('base64url')
    ).toBe(authorize!.searchParams.get('code_challenge'));

    await expect(source.accessToken()).resolves.toBe('access-1');

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    const stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored[`${ISSUER} ${redirectUri(callbackPort)}`]).toMatchObject({
      client_id: 'client-1',
      client_secret: 'secret-1',
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    });
  });

  test('reuses the stored client instead of registering again', async () => {
    const store = createMemoryStore();
    await loginWith(store);
    await loginWith(store);

    expect(registerRequests).toHaveLength(1);
    expect(tokenRequests).toHaveLength(2);
  });

  test('rejects a callback whose state does not match', async () => {
    const browser = fakeBrowser({ state: 'forged' });

    await expect(loginWith(createMemoryStore(), browser)).rejects.toThrow(
      /state mismatch/
    );
    expect(browser.callbackStatuses).toEqual([400]);
    expect(tokenRequests).toHaveLength(0);
  });

  test('refuses metadata without S256 or with a foreign issuer', async () => {
    mockServer.use(
      http.get(WELL_KNOWN, () =>
        HttpResponse.json({
          ...metadata(ISSUER),
          code_challenge_methods_supported: ['plain'],
        })
      )
    );
    await expect(fetchAuthorizationServerMetadata(ISSUER)).rejects.toThrow(
      /S256/
    );

    mockServer.use(
      http.get(WELL_KNOWN, () =>
        HttpResponse.json(metadata('https://other.test'))
      )
    );
    await expect(fetchAuthorizationServerMetadata(ISSUER)).rejects.toThrow(
      /issuer mismatch/
    );
  });
});

describe('accessToken', () => {
  test('returns the cached token, refreshes once on expiry, never on demand', async () => {
    const source = await loginWith(createMemoryStore());

    await expect(source.accessToken()).resolves.toBe('access-1');
    await expect(source.accessToken()).resolves.toBe('access-1');
    expect(tokenRequests).toHaveLength(1);

    expireCurrentToken();
    await expect(source.accessToken()).resolves.toBe('access-2');
    expect(tokenRequests).toHaveLength(2);
    const [, refresh] = tokenRequests;
    expect(refresh!.get('grant_type')).toBe('refresh_token');
    expect(refresh!.get('refresh_token')).toBe('refresh-1');
    expect(refresh!.get('client_id')).toBe('client-1');
    expect(refresh!.get('client_secret')).toBe('secret-1');

    // A caller that just saw an API 401 has no way to force a refresh: the
    // fresh token is served from cache until it expires.
    await expect(source.accessToken()).resolves.toBe('access-2');
    expect(tokenRequests).toHaveLength(2);
  });

  test('serializes concurrent callers through one refresh', async () => {
    const source = await loginWith(createMemoryStore());
    expireCurrentToken();

    const tokens = await Promise.all([
      source.accessToken(),
      source.accessToken(),
    ]);

    expect(tokens).toEqual(['access-2', 'access-2']);
    expect(
      tokenRequests.filter((form) => form.get('grant_type') === 'refresh_token')
    ).toHaveLength(1);
  });

  test('retries a failed refresh on the next call', async () => {
    const source = await loginWith(createMemoryStore());
    expireCurrentToken();
    mockServer.use(
      http.post(
        `${ISSUER}/v1/oauth/token`,
        () => new HttpResponse('nope', { status: 500 }),
        { once: true }
      )
    );

    await expect(source.accessToken()).rejects.toThrow(/token refresh failed/);
    await expect(source.accessToken()).resolves.toBe('access-2');
  });
});

describe('logout', () => {
  test('revokes both tokens and forgets the client', async () => {
    const store = createMemoryStore();
    await loginWith(store);

    await expect(logout({ issuer: ISSUER, callbackPort, store })).resolves.toBe(
      true
    );

    expect(revokeRequests.map((form) => form.get('token'))).toEqual([
      'access-1',
      'refresh-1',
    ]);
    for (const form of revokeRequests) {
      expect(form.get('client_id')).toBe('client-1');
      expect(form.get('client_secret')).toBe('secret-1');
    }
    await expect(
      store.load(`${ISSUER} ${redirectUri(callbackPort)}`)
    ).resolves.toBeUndefined();
    await expect(logout({ issuer: ISSUER, callbackPort, store })).resolves.toBe(
      false
    );
  });
});
