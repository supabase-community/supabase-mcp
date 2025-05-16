import { Hono } from 'hono';
import { createSupabaseMcpServer } from '../server.js';
import { StatelessHttpServerTransport } from '@supabase/mcp-utils';
import { serve } from '@hono/node-server';
import { createManagementApiClient } from '../management-api/index.js';

const managementApiUrl =
  process.env.SUPABASE_API_URL ?? 'https://api.supabase.com';

const app = new Hono();

/**
 * Stateless HTTP transport for the Supabase MCP server.
 */
app.all('/mcp', async (c) => {
  const projectId = c.req.query('project-ref');
  const readOnly = c.req.query('read-only') === 'true';
  const apiUrl = c.req.query('api-url');

  const accessToken = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) in the Authorization header'
    );
    return c.json({ error: 'Access token is required' }, 401);
  }

  const server = createSupabaseMcpServer({
    platform: {
      accessToken,
      apiUrl,
    },
    projectId,
    readOnly,
  });

  const transport = new StatelessHttpServerTransport();
  await server.connect(transport);
  return await transport.handleRequest(c.req.raw);
});

app.get('/authorize', async (c) => {
  console.log('Request to /authorize');

  const clientId = c.req.query('client_id');
  const responseType = c.req.query('response_type');
  const redirectUri = c.req.query('redirect_uri');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method') || 'S256';
  const state = c.req.query('state');
  const projectId = c.req.query('project-ref');

  // Validate required parameters
  if (
    !clientId ||
    !responseType ||
    !redirectUri ||
    !codeChallenge ||
    !projectId
  ) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      },
      400
    );
  }

  // Validate response_type (only 'code' is supported for OAuth 2.1)
  if (responseType !== 'code') {
    return c.json(
      {
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      },
      400
    );
  }

  // Validate PKCE challenge method
  if (codeChallengeMethod !== 'S256') {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'Only S256 PKCE challenge method is supported',
      },
      400
    );
  }

  try {
    const managementApiClient = createManagementApiClient(managementApiUrl);

    const response = await managementApiClient.GET('/v1/oauth/authorize', {
      params: {
        query: {
          client_id: clientId,
          response_type: responseType,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          state: state,
        },
      },
    });

    // The API returns a 303 redirect response
    if (response.response.status === 303) {
      const location = response.response.headers.get('location');
      if (location) {
        return c.redirect(location);
      }
    }

    return c.json(
      {
        error: 'server_error',
        error_description: 'Authorization failed',
      },
      500
    );
  } catch (error) {
    console.error('/authorize error:', error);
    return c.json(
      {
        error: 'server_error',
        error_description: 'Internal server error',
      },
      500
    );
  }
});

app.post('/oauth/token', async (c) => {
  const body = await c.req.json();
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = body;

  // Validate grant type
  if (!['authorization_code', 'refresh_token'].includes(grant_type)) {
    return c.json(
      {
        error: 'unsupported_grant_type',
        error_description:
          'Only authorization_code and refresh_token grant types are supported',
      },
      400
    );
  }

  try {
    const managementApiClient = createManagementApiClient(managementApiUrl);

    const response = await managementApiClient.POST('/v1/oauth/token', {
      body: {
        grant_type,
        code,
        redirect_uri,
        client_id,
        client_secret,
        code_verifier,
        refresh_token,
      },
    });

    if ('error' in response) {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'Token exchange failed',
        },
        400
      );
    }

    return c.json(response.data);
  } catch (error) {
    console.error('/oauth/token error:', error);
    return c.json(
      {
        error: 'server_error',
        error_description: 'Internal server error',
      },
      500
    );
  }
});

app.post('/oauth/revoke', async (c) => {
  const body = await c.req.json();
  const { client_id, client_secret, refresh_token } = body;

  // Validate required parameters
  if (!client_id || !client_secret || !refresh_token) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      },
      400
    );
  }

  try {
    const managementApiClient = createManagementApiClient(managementApiUrl);

    const response = await managementApiClient.POST('/v1/oauth/revoke', {
      body: {
        client_id,
        client_secret,
        refresh_token,
      },
    });

    // Token revocation should return 204 No Content on success
    if (response.response.status === 204) {
      return new Response(null, { status: 204 });
    }

    return c.json(
      {
        error: 'server_error',
        error_description: 'Token revocation failed',
      },
      500
    );
  } catch (error) {
    console.error('/oauth/revoke error:', error);
    return c.json(
      {
        error: 'server_error',
        error_description: 'Internal server error',
      },
      500
    );
  }
});

app.post('/oauth/register', async (c) => {
  console.log('Request to /oauth/register');

  const body = await c.req.json();
  const {
    client_name,
    redirect_uris,
    token_endpoint_auth_method = 'client_secret_post',
    grant_types = ['authorization_code'],
    response_types = ['code'],
    scope,
  } = body;

  console.log('Request body:', body);

  // Validate required parameters
  if (
    !client_name ||
    !redirect_uris ||
    !Array.isArray(redirect_uris) ||
    redirect_uris.length === 0
  ) {
    return c.json(
      {
        error: 'invalid_request',
        error_description:
          'Missing required parameters or invalid redirect_uris',
      },
      400
    );
  }

  // Validate supported auth methods
  if (
    !['client_secret_basic', 'client_secret_post'].includes(
      token_endpoint_auth_method
    )
  ) {
    return c.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'Unsupported token endpoint auth method',
      },
      400
    );
  }

  // Validate grant types
  const invalidGrantTypes = grant_types.filter(
    (gt: string) => !['authorization_code', 'refresh_token'].includes(gt)
  );
  if (invalidGrantTypes.length > 0) {
    return c.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'Unsupported grant types requested',
      },
      400
    );
  }

  // Validate response types
  if (!response_types.every((rt: string) => rt === 'code')) {
    return c.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'Only response_type=code is supported',
      },
      400
    );
  }

  try {
    const clientId = '95c0f4c2-f0bc-42f9-a04a-10a397510d6a';
    const clientSecret = 'sba_fc16dc293220c171421251ae852aced63c21c952';

    const clientCredentials = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      redirect_uris,
      grant_types,
      response_types,
      token_endpoint_auth_method,
      // registration_access_token: registrationToken,
      // registration_client_uri: `${new URL(c.req.url).origin}/oauth/register/${clientId}`,
      scope,
    };

    return c.json(clientCredentials, 201);
  } catch (error) {
    console.error('/oauth/register error:', error);
    return c.json(
      {
        error: 'server_error',
        error_description: 'Internal server error',
      },
      500
    );
  }
});

// app.get('/oauth/register/:client_id', async (c) => {
//   const projectId = c.req.query('project-ref');
//   const clientId = c.req.param('client_id');
//   const registrationAccessToken = c.req.header('Authorization')?.replace('Bearer ', '');

//   if (!projectId || !clientId || !registrationAccessToken) {
//     return c.json(
//       {
//         error: 'invalid_request',
//         error_description: 'Missing required parameters',
//       },
//       400
//     );
//   }

//   try {
//     const managementApiClient = createManagementApiClient(managementApiUrl);

//     const response = await managementApiClient.GET('/v1/projects/{ref}/config/auth/third-party-auth/{tpa_id}', {
//       params: {
//         path: {
//           ref: projectId,
//           tpa_id: clientId
//         }
//       },
//       headers: {
//         Authorization: `Bearer ${registrationAccessToken}`
//       }
//     });

//     if ('error' in response) {
//       return c.json(
//         {
//           error: 'invalid_token',
//           error_description: 'Invalid registration access token',
//         },
//         401
//       );
//     }

//     // Access data from custom_jwks since that's where we store client metadata
//     const metadata = response.data.custom_jwks as any;

//     // Transform the response to match RFC7591 format
//     const clientConfig = {
//       client_id: clientId,
//       client_name: metadata.client_id,
//       redirect_uris: metadata.redirect_uris,
//       token_endpoint_auth_method: metadata.token_endpoint_auth_method,
//       grant_types: metadata.grant_types,
//       response_types: metadata.response_types,
//       scope: metadata.scope,
//       registration_access_token: registrationAccessToken,
//       registration_client_uri: `${new URL(c.req.url).origin}/oauth/register/${clientId}`
//     };

//     return c.json(clientConfig);
//   } catch (error) {
//     console.error('/oauth/register/:client_id GET error:', error);
//     return c.json(
//       {
//         error: 'server_error',
//         error_description: 'Internal server error',
//       },
//       500
//     );
//   }
// });

// app.put('/oauth/register/:client_id', async (c) => {
//   const projectId = c.req.query('project-ref');
//   const clientId = c.req.param('client_id');
//   const registrationAccessToken = c.req.header('Authorization')?.replace('Bearer ', '');

//   if (!projectId || !clientId || !registrationAccessToken) {
//     return c.json(
//       {
//         error: 'invalid_request',
//         error_description: 'Missing required parameters',
//       },
//       400
//     );
//   }

//   const body = await c.req.json();
//   const {
//     client_name,
//     redirect_uris,
//     token_endpoint_auth_method = 'client_secret_post',
//     grant_types = ['authorization_code'],
//     response_types = ['code'],
//     scope
//   } = body;

//   // Validate required parameters
//   if (!client_name || !redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
//     return c.json(
//       {
//         error: 'invalid_request',
//         error_description: 'Missing required parameters or invalid redirect_uris',
//       },
//       400
//     );
//   }

//   // Validate supported auth methods
//   if (!['client_secret_basic', 'client_secret_post'].includes(token_endpoint_auth_method)) {
//     return c.json(
//       {
//         error: 'invalid_client_metadata',
//         error_description: 'Unsupported token endpoint auth method',
//       },
//       400
//     );
//   }

//   // Validate grant types
//   const invalidGrantTypes = grant_types.filter(
//     (gt: string) => !['authorization_code', 'refresh_token'].includes(gt)
//   );
//   if (invalidGrantTypes.length > 0) {
//     return c.json(
//       {
//         error: 'invalid_client_metadata',
//         error_description: 'Unsupported grant types requested',
//       },
//       400
//     );
//   }

//   // Validate response types
//   if (!response_types.every((rt: string) => rt === 'code')) {
//     return c.json(
//       {
//         error: 'invalid_client_metadata',
//         error_description: 'Only response_type=code is supported',
//       },
//       400
//     );
//   }

//   try {
//     const managementApiClient = createManagementApiClient(managementApiUrl);

//     // Update third-party auth configuration
//     const response = await managementApiClient.POST('/v1/projects/{ref}/config/auth/third-party-auth/{tpa_id}', {
//       params: {
//         path: {
//           ref: projectId,
//           tpa_id: clientId
//         }
//       },
//       headers: {
//         Authorization: `Bearer ${registrationAccessToken}`
//       },
//       body: {
//         type: 'oauth',
//         oidc_issuer_url: `${new URL(c.req.url).origin}`,
//         jwks_url: `${new URL(c.req.url).origin}/.well-known/jwks.json`,
//         custom_jwks: {
//           client_id: client_name,
//           redirect_uris,
//           token_endpoint_auth_method,
//           grant_types,
//           response_types,
//           scope
//         }
//       }
//     });

//     if ('error' in response) {
//       return c.json(
//         {
//           error: 'invalid_token',
//           error_description: 'Invalid registration access token',
//         },
//         401
//       );
//     }

//     // Return updated client configuration
//     const clientConfig = {
//       client_id: clientId,
//       client_name,
//       redirect_uris,
//       token_endpoint_auth_method,
//       grant_types,
//       response_types,
//       scope,
//       registration_access_token: registrationAccessToken,
//       registration_client_uri: `${new URL(c.req.url).origin}/oauth/register/${clientId}`
//     };

//     return c.json(clientConfig);
//   } catch (error) {
//     console.error('/oauth/register/:client_id PUT error:', error);
//     return c.json(
//       {
//         error: 'server_error',
//         error_description: 'Internal server error',
//       },
//       500
//     );
//   }
// });

app.get('/.well-known/oauth-authorization-server', async (c) => {
  console.log('Request to /.well-known/oauth-authorization-server');
  const baseUrl = new URL(c.req.url).origin;

  const mcpProtocolVersion = c.req.header('MCP-Protocol-Version');

  console.log('MCP-Protocol-Version:', mcpProtocolVersion);

  if (mcpProtocolVersion !== '2024-11-05') {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'Unsupported MCP protocol version',
      },
      400
    );
  }

  console.log('Base URL:', baseUrl);

  // Metadata document according to RFC8414
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${managementApiUrl}/v1/oauth/authorize`,
    token_endpoint: `${managementApiUrl}/v1/oauth/token`,
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
    ],
    token_endpoint_auth_signing_alg_values_supported: ['RS256'],
    revocation_endpoint: `${managementApiUrl}/v1/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
    ],
    registration_endpoint: `${baseUrl}/oauth/register`,
    registration_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
    ],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    scopes_supported: ['openid', 'profile', 'email'],
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    service_documentation: 'https://supabase.com/docs/guides/auth',
    response_modes_supported: ['query'],
    id_token_signing_alg_values_supported: ['RS256'],
    id_token_encryption_alg_values_supported: ['RSA-OAEP'],
    id_token_encryption_enc_values_supported: ['A128CBC-HS256'],
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
    require_request_uri_registration: false,
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'email',
      'email_verified',
      'phone',
      'phone_verified',
      'name',
      'picture',
    ],
    claims_parameter_supported: false,
    backchannel_logout_supported: false,
    frontchannel_logout_supported: false,
  });
});

app.get('/.well-known/jwks.json', async (c) => {
  const projectId = c.req.query('project-ref');

  if (!projectId) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'project-ref parameter is required',
      },
      400
    );
  }

  try {
    const managementApiClient = createManagementApiClient(managementApiUrl);

    // Get the project's signing keys
    const response = await managementApiClient.GET(
      '/v1/projects/{ref}/config/auth/signing-keys',
      {
        params: {
          path: {
            ref: projectId,
          },
        },
      }
    );

    if ('error' in response) {
      return c.json(
        {
          error: 'server_error',
          error_description: 'Failed to retrieve signing keys',
        },
        500
      );
    }

    // Transform signing keys to JWKS format
    const keys = response.data.keys.map(
      (key: { id: string; algorithm: string; public_jwk?: unknown }) => ({
        kty: 'RSA',
        kid: key.id,
        use: 'sig',
        alg: key.algorithm,
        ...(key.public_jwk as object),
      })
    );

    return c.json({ keys });
  } catch (error) {
    console.error('/.well-known/jwks.json error:', error);
    return c.json(
      {
        error: 'server_error',
        error_description: 'Internal server error',
      },
      500
    );
  }
});

serve(
  {
    fetch: app.fetch,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  },
  () => {
    console.log('Server is running on port', process.env.PORT || 3000);
  }
);
