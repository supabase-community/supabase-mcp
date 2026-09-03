import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod/v4';

// The `--http --oauth` entry acts as an OAuth client to the Supabase
// authorization server, the same way MCP Inspector does. The client is
// hand-written on purpose: the whole flow is four fetches (metadata, dynamic
// registration, token, refresh) plus one loopback callback, and reusing the
// SDK's client-side auth would promote `@modelcontextprotocol/client` to a
// runtime dependency of the server package.
//
// The authorize request carries no `resource` parameter: the platform AS only
// accepts the hosted MCP URL there and rejects anything else, and the token it
// issues is a Management API token that is not audience-bound to this entry.
//
// Tokens refresh on expiry only (60 s of slack), never in response to an API
// 401: the two storage-config tools 401 under any OAuth token by design, and a
// refresh-on-401 loop would burn the single-use refresh token for nothing.

export type StoredClient = {
  client_id: string;
  client_secret: string;
  access_token?: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at?: number;
};

export type OAuthStore = {
  load(key: string): Promise<StoredClient | undefined>;
  save(key: string, value: StoredClient): Promise<void>;
  delete(key: string): Promise<void>;
};

export type TokenSource = {
  accessToken: () => Promise<string>;
};

type FetchFn = typeof fetch;

export const DEFAULT_OAUTH_STORE_PATH = join(
  homedir(),
  '.supabase',
  'mcp-oauth.json'
);

const CLIENT_NAME = 'supabase-mcp local http entry';
const CALLBACK_PATH = '/oauth/callback';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const EXPIRY_SLACK_MS = 60 * 1000;

export function redirectUri(callbackPort: number) {
  return `http://127.0.0.1:${callbackPort}${CALLBACK_PATH}`;
}

function storeKey(issuer: string, redirect: string) {
  return `${issuer} ${redirect}`;
}

export function createMemoryStore(): OAuthStore {
  const entries = new Map<string, StoredClient>();
  return {
    async load(key) {
      return entries.get(key);
    },
    async save(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}

export function createFileStore(
  path: string = DEFAULT_OAUTH_STORE_PATH
): OAuthStore {
  type FileShape = Record<string, StoredClient>;

  async function readAll(): Promise<FileShape> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as FileShape;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  async function writeAll(entries: FileShape) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(entries, null, 2), { mode: 0o600 });
    // `mode` only applies when the file is created; keep an existing file tight.
    await chmod(path, 0o600);
  }

  return {
    async load(key) {
      return (await readAll())[key];
    },
    async save(key, value) {
      const entries = await readAll();
      entries[key] = value;
      await writeAll(entries);
    },
    async delete(key) {
      const entries = await readAll();
      if (!(key in entries)) return;
      delete entries[key];
      await writeAll(entries);
    },
  };
}

const metadataSchema = z.looseObject({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url().optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});

export type AuthorizationServerMetadata = z.infer<typeof metadataSchema>;

const registrationSchema = z.looseObject({
  client_id: z.string(),
  client_secret: z.string(),
});

const tokenSchema = z.looseObject({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

function trimSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export async function fetchAuthorizationServerMetadata(
  issuer: string,
  fetchFn: FetchFn = fetch
): Promise<AuthorizationServerMetadata> {
  const url = `${trimSlash(issuer)}/.well-known/oauth-authorization-server`;
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new Error(
      `could not fetch authorization server metadata from ${url}: ${(error as Error).message}`,
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(
      `could not fetch authorization server metadata from ${url}: HTTP ${response.status}`
    );
  }
  const parsed = metadataSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `authorization server metadata at ${url} is malformed: ${parsed.error.message}`
    );
  }
  const metadata = parsed.data;
  if (trimSlash(metadata.issuer) !== trimSlash(issuer)) {
    throw new Error(
      `authorization server metadata issuer mismatch: requested ${issuer}, got ${metadata.issuer}`
    );
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error(
      `authorization server ${issuer} does not support PKCE S256, which this client requires`
    );
  }
  return metadata;
}

async function postForm(
  fetchFn: FetchFn,
  url: string,
  form: Record<string, string>
) {
  return fetchFn(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  });
}

async function describeFailure(response: Response) {
  const text = await response.text().catch(() => '');
  return `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
}

async function register(
  metadata: AuthorizationServerMetadata,
  redirect: string,
  fetchFn: FetchFn
): Promise<StoredClient> {
  if (!metadata.registration_endpoint) {
    throw new Error(
      `authorization server ${metadata.issuer} does not advertise a registration endpoint`
    );
  }
  const response = await fetchFn(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });
  if (!response.ok) {
    throw new Error(
      `client registration failed: ${await describeFailure(response)}`
    );
  }
  const parsed = registrationSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `client registration response is malformed: ${parsed.error.message}`
    );
  }
  return {
    client_id: parsed.data.client_id,
    client_secret: parsed.data.client_secret,
  };
}

async function exchange(
  tokenEndpoint: string,
  form: Record<string, string>,
  fetchFn: FetchFn,
  what: string
) {
  const response = await postForm(fetchFn, tokenEndpoint, form);
  if (!response.ok) {
    throw new Error(`${what} failed: ${await describeFailure(response)}`);
  }
  const parsed = tokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`${what} response is malformed: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Listens for the browser redirect; `ready` settles once the port is bound, `code` once the user returns. */
function startCallbackServer(callbackPort: number, expectedState: string) {
  let ready!: () => void;
  let listenFailed!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    ready = resolve;
    listenFailed = reject;
  });
  const code = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${callbackPort}`);
      if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const fail = (message: string) => {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(message);
        finish(() => reject(new Error(`OAuth login failed: ${message}`)));
      };
      if (state !== expectedState) return fail('state mismatch');
      if (error) {
        return fail(
          `${error}${url.searchParams.get('error_description') ? `: ${url.searchParams.get('error_description')}` : ''}`
        );
      }
      if (!code) return fail('missing code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><title>Signed in</title><p>Signed in to Supabase. You can close this tab.</p>'
      );
      finish(() => resolve(code));
    });

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error('OAuth login timed out waiting for the browser'))
      );
    }, LOGIN_TIMEOUT_MS);

    function finish(settle: () => void) {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      settle();
    }

    server.once('error', (error) => {
      clearTimeout(timer);
      const wrapped = new Error(
        `could not listen on ${redirectUri(callbackPort)} for the OAuth callback: ${error.message}`,
        { cause: error }
      );
      listenFailed(wrapped);
      reject(wrapped);
    });
    server.listen(callbackPort, '127.0.0.1', ready);
  });
  return { ready: readyPromise, code };
}

export function defaultOpenBrowser(url: string) {
  if (process.env.SUPABASE_MCP_NO_BROWSER === '1' || !process.stdout.isTTY) {
    return;
  }
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    // The URL is already printed, so a missing opener is not an error.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Same: the printed URL is the fallback.
  }
}

export type LoginOptions = {
  issuer: string;
  callbackPort: number;
  store: OAuthStore;
  openBrowser?: (url: string) => void | Promise<void>;
  log?: (line: string) => void;
  fetchFn?: FetchFn;
};

export async function login(options: LoginOptions): Promise<TokenSource> {
  const {
    issuer,
    callbackPort,
    store,
    openBrowser = defaultOpenBrowser,
    log = console.error,
    fetchFn = fetch,
  } = options;
  const redirect = redirectUri(callbackPort);
  const key = `${issuer} ${redirect}`;

  const metadata = await fetchAuthorizationServerMetadata(issuer, fetchFn);
  let client = await store.load(key);
  if (!client) {
    client = await register(metadata, redirect, fetchFn);
    await store.save(key, client);
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const callback = startCallbackServer(callbackPort, state);
  // The callback may settle while we are still awaiting the browser opener;
  // a handler now keeps an early rejection from surfacing as unhandled.
  callback.code.catch(() => undefined);
  // A busy port must fail here, before the user is sent to the browser.
  await callback.ready;

  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  log(`Sign in to Supabase in your browser:\n${authorizeUrl}`);
  await openBrowser(authorizeUrl.toString());

  const code = await callback.code;
  const tokens = await exchange(
    metadata.token_endpoint,
    {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      client_id: client.client_id,
      client_secret: client.client_secret,
    },
    fetchFn,
    'token exchange'
  );
  client = withTokens(client, tokens);
  await store.save(key, client);

  return createTokenSource({
    tokenEndpoint: metadata.token_endpoint,
    store,
    key,
    client,
    fetchFn,
  });
}

function withTokens(
  client: StoredClient,
  tokens: z.infer<typeof tokenSchema>
): StoredClient {
  return {
    client_id: client.client_id,
    client_secret: client.client_secret,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? client.refresh_token,
    expires_at:
      tokens.expires_in === undefined
        ? undefined
        : Date.now() + tokens.expires_in * 1000,
  };
}

export type TokenSourceOptions = {
  tokenEndpoint: string;
  store: OAuthStore;
  key: string;
  client: StoredClient;
  fetchFn?: FetchFn;
};

export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const { tokenEndpoint, store, key, fetchFn = fetch } = options;
  let client = options.client;
  // MCP clients send `initialize` and `tools/list` concurrently and the refresh
  // token is single-use, so concurrent callers share one in-flight refresh.
  let refreshing: Promise<string> | undefined;

  async function refresh(): Promise<string> {
    if (!client.refresh_token) {
      throw new Error('OAuth session expired; restart with --http --oauth');
    }
    const tokens = await exchange(
      tokenEndpoint,
      {
        grant_type: 'refresh_token',
        refresh_token: client.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      },
      fetchFn,
      'token refresh'
    );
    client = withTokens(client, tokens);
    await store.save(key, client);
    return tokens.access_token;
  }

  return {
    accessToken() {
      const { access_token, expires_at } = client;
      if (
        access_token &&
        (expires_at === undefined || expires_at - EXPIRY_SLACK_MS > Date.now())
      ) {
        return Promise.resolve(access_token);
      }
      refreshing ??= refresh().finally(() => {
        refreshing = undefined;
      });
      return refreshing;
    },
  };
}

export type LogoutOptions = {
  issuer: string;
  callbackPort: number;
  store: OAuthStore;
  fetchFn?: FetchFn;
};

/** Revokes both tokens (best effort) and forgets the client. Returns false when nothing was stored. */
export async function logout(options: LogoutOptions): Promise<boolean> {
  const { issuer, callbackPort, store, fetchFn = fetch } = options;
  const key = storeKey(issuer, redirectUri(callbackPort));
  const client = await store.load(key);
  if (!client) return false;

  const revokeEndpoint = `${trimSlash(issuer)}/v1/oauth/revoke`;
  for (const token of [client.access_token, client.refresh_token]) {
    if (!token) continue;
    await postForm(fetchFn, revokeEndpoint, {
      token,
      client_id: client.client_id,
      client_secret: client.client_secret,
    }).catch(() => undefined);
  }
  await store.delete(key);
  return true;
}
