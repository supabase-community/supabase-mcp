import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as oauth from 'oauth4webapi';

// The `--http --oauth` entry acts as an OAuth client to the Supabase
// authorization server, the same way MCP Inspector does. oauth4webapi handles
// the protocol core (discovery, dynamic registration, PKCE, code exchange,
// refresh); reusing the SDK's client-side auth instead would promote
// `@modelcontextprotocol/client` to a runtime dependency of the server package.
// Policy stays here: token stores, the loopback callback server, single-flight
// refresh, the loopback-only HTTP rule, the S256 check and revocation.
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
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(entries, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
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

const LOOPBACK_OAUTH_HOSTS: Record<string, true> = {
  '127.0.0.1': true,
  localhost: true,
  '[::1]': true,
};

function assertSecureOAuthUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`);
  }
  const secure =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && LOOPBACK_OAUTH_HOSTS[url.hostname] === true);
  if (!secure) {
    throw new Error(`${label} must use HTTPS outside loopback: ${value}`);
  }
}

/** oauth4webapi refuses plain HTTP unless told otherwise; only a loopback issuer earns that. */
function requestOptions(issuer: string, fetchFn: FetchFn) {
  const loopback = LOOPBACK_OAUTH_HOSTS[new URL(issuer).hostname] === true;
  return {
    [oauth.customFetch]: fetchFn,
    ...(loopback ? { [oauth.allowInsecureRequests]: true } : {}),
  };
}

/** Flattens oauth4webapi's error classes into the one-line messages this entry prints. */
function describeError(error: unknown) {
  if (error instanceof oauth.ResponseBodyError) {
    return `HTTP ${error.status}: ${error.error}${error.error_description ? `: ${error.error_description}` : ''}`;
  }
  if (error instanceof oauth.AuthorizationResponseError) {
    return `${error.error}${error.error_description ? `: ${error.error_description}` : ''}`;
  }
  if (
    error instanceof oauth.OperationProcessingError &&
    error.cause instanceof Response
  ) {
    return `${error.message} (HTTP ${error.cause.status})`;
  }
  return (error as Error).message;
}

/** Runs one protocol step and rewraps whatever the library throws under our step name. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`${name}: ${describeError(error)}`, { cause: error });
  }
}

export async function fetchAuthorizationServerMetadata(
  issuer: string,
  fetchFn: FetchFn = fetch
): Promise<oauth.AuthorizationServer> {
  assertSecureOAuthUrl(issuer, 'authorization server issuer');
  const issuerUrl = new URL(issuer);
  const metadata = await step(
    `could not fetch authorization server metadata for ${issuer}`,
    async () => {
      const response = await oauth.discoveryRequest(issuerUrl, {
        algorithm: 'oauth2',
        ...requestOptions(issuer, fetchFn),
      });
      return oauth.processDiscoveryResponse(issuerUrl, response);
    }
  );
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(
      `authorization server metadata for ${issuer} is malformed: missing authorization_endpoint or token_endpoint`
    );
  }
  assertSecureOAuthUrl(metadata.issuer, 'authorization server issuer');
  assertSecureOAuthUrl(
    metadata.authorization_endpoint,
    'authorization endpoint'
  );
  assertSecureOAuthUrl(metadata.token_endpoint, 'token endpoint');
  if (metadata.registration_endpoint) {
    assertSecureOAuthUrl(
      metadata.registration_endpoint,
      'registration endpoint'
    );
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error(
      `authorization server ${issuer} does not support PKCE S256, which this client requires`
    );
  }
  return metadata;
}

async function register(
  as: oauth.AuthorizationServer,
  redirect: string,
  fetchFn: FetchFn
): Promise<StoredClient> {
  if (!as.registration_endpoint) {
    throw new Error(
      `authorization server ${as.issuer} does not advertise a registration endpoint`
    );
  }
  const { client_id, client_secret } = await step(
    'client registration failed',
    async () => {
      const response = await oauth.dynamicClientRegistrationRequest(
        as,
        {
          client_name: CLIENT_NAME,
          redirect_uris: [redirect],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
        },
        requestOptions(as.issuer, fetchFn)
      );
      return oauth.processDynamicClientRegistrationResponse(response);
    }
  );
  if (typeof client_secret !== 'string' || client_secret.length === 0) {
    throw new Error(
      'client registration response is malformed: no client_secret was issued'
    );
  }
  return { client_id, client_secret };
}

/** Listens for the browser redirect; `ready` settles once the port is bound, `params` once the user returns. */
function startCallbackServer(
  callbackPort: number,
  validate: (url: URL) => URLSearchParams
) {
  let ready!: Promise<void>;
  const params = new Promise<URLSearchParams>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${callbackPort}`);
      if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      const fail = (message: string) => {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(message);
        finish(() => reject(new Error(`OAuth login failed: ${message}`)));
      };
      let validated: URLSearchParams;
      try {
        validated = validate(url);
      } catch (error) {
        return fail(describeError(error));
      }
      if (!validated.has('code')) return fail('missing code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><title>Signed in</title><p>Signed in to Supabase. You can close this tab.</p>'
      );
      finish(() => resolve(validated));
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

    ready = new Promise<void>((bound, failed) => {
      server.once('error', failed);
      server.listen(callbackPort, '127.0.0.1', () => {
        server.off('error', failed);
        bound();
      });
    }).catch((error: Error) => {
      clearTimeout(timer);
      const wrapped = new Error(
        `could not listen on ${redirectUri(callbackPort)} for the OAuth callback: ${error.message}`,
        { cause: error }
      );
      reject(wrapped);
      throw wrapped;
    });
  });
  return { ready, params };
}

export function defaultOpenBrowser(url: string) {
  if (process.env.SUPABASE_MCP_NO_BROWSER === '1' || !process.stdout.isTTY) {
    return;
  }
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
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

  const as = await fetchAuthorizationServerMetadata(issuer, fetchFn);
  let client = await store.load(key);
  if (client && (client.access_token || client.refresh_token)) {
    const storedSource = createTokenSource({
      authorizationServer: as,
      store,
      key,
      client,
      fetchFn,
    });
    try {
      await storedSource.accessToken();
      return storedSource;
    } catch {
      // A revoked or otherwise unusable stored session must not require the
      // user to find and delete the store before signing in again. Clear the
      // stale tokens before the authorization-code response is merged.
      client = {
        client_id: client.client_id,
        client_secret: client.client_secret,
      };
    }
  }
  if (!client) {
    client = await register(as, redirect, fetchFn);
    await store.save(key, client);
  }

  const verifier = oauth.generateRandomCodeVerifier();
  const challenge = await oauth.calculatePKCECodeChallenge(verifier);
  const state = oauth.generateRandomState();
  const asClient: oauth.Client = { client_id: client.client_id };

  const callback = startCallbackServer(callbackPort, (url) => {
    // The library's message for a bad state names the parameter; ours stays
    // the plain "state mismatch" the browser tab shows.
    if (url.searchParams.get('state') !== state) {
      throw new Error('state mismatch');
    }
    return oauth.validateAuthResponse(as, asClient, url, state);
  });
  // The callback may settle while we are still awaiting the browser opener;
  // a handler now keeps an early rejection from surfacing as unhandled.
  callback.params.catch(() => undefined);
  // A busy port must fail here, before the user is sent to the browser.
  await callback.ready;

  // `as.authorization_endpoint` was asserted present during discovery.
  const authorizeUrl = new URL(as.authorization_endpoint!);
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

  const callbackParams = await callback.params;
  const clientAuth = oauth.ClientSecretPost(client.client_secret);
  const tokens = await step('token exchange failed', async () => {
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      asClient,
      clientAuth,
      callbackParams,
      redirect,
      verifier,
      requestOptions(issuer, fetchFn)
    );
    return oauth.processAuthorizationCodeResponse(as, asClient, response);
  });
  client = withTokens(client, tokens);
  await store.save(key, client);

  return createTokenSource({
    authorizationServer: as,
    store,
    key,
    client,
    fetchFn,
  });
}

function withTokens(
  client: StoredClient,
  tokens: oauth.TokenEndpointResponse
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
  authorizationServer: oauth.AuthorizationServer;
  store: OAuthStore;
  key: string;
  client: StoredClient;
  fetchFn?: FetchFn;
};

export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const { authorizationServer: as, store, key, fetchFn = fetch } = options;
  let client = options.client;
  // MCP clients send `initialize` and `tools/list` concurrently and the refresh
  // token is single-use, so concurrent callers share one in-flight refresh.
  let refreshing: Promise<string> | undefined;

  async function refresh(): Promise<string> {
    if (!client.refresh_token) {
      throw new Error('OAuth session expired; restart with --http --oauth');
    }
    const asClient: oauth.Client = { client_id: client.client_id };
    const refreshToken = client.refresh_token;
    const tokens = await step('token refresh failed', async () => {
      const response = await oauth.refreshTokenGrantRequest(
        as,
        asClient,
        oauth.ClientSecretPost(client.client_secret),
        refreshToken,
        requestOptions(as.issuer, fetchFn)
      );
      return oauth.processRefreshTokenResponse(as, asClient, response);
    });
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
  const key = `${issuer} ${redirectUri(callbackPort)}`;
  const client = await store.load(key);
  if (!client) return false;

  const revokeEndpoint = `${issuer.replace(/\/+$/, '')}/v1/oauth/revoke`;
  for (const token of [client.access_token, client.refresh_token]) {
    if (!token) continue;
    await fetchFn(revokeEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }).toString(),
    }).catch(() => undefined);
  }
  await store.delete(key);
  return true;
}
