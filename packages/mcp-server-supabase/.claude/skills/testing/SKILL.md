---
name: mcp-server-supabase-testing
description: Testing patterns for the Supabase MCP server including MSW HTTP mocking, PGlite database mocking, and AI-powered assertions. Use when writing tests, setting up mocks, or debugging test failures.
---

# Testing Patterns

## Test Types

- **Unit**: `src/**/*.test.ts` - Co-located with source
- **E2E**: `test/e2e/**/*.e2e.ts` - Requires `SUPABASE_ACCESS_TOKEN`
- **Integration**: `test/**/*.integration.ts`

## HTTP Mocking with MSW

All unit tests MUST mock HTTP calls using MSW. Mocks are defined in `test/mocks.ts`.

```typescript
import { setupServer } from 'msw/node';
import { mockManagementApi } from './mocks.ts';

const server = setupServer(...mockManagementApi);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
  mockOrgs.clear();
  mockProjects.clear();
});
afterAll(() => server.close());
```

## Database Mocking with PGlite

```typescript
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.waitReady;
await db.exec(`
  CREATE ROLE supabase_read_only_role;
  GRANT pg_read_all_data TO supabase_read_only_role;
`);
```

## AI Test Matcher

Custom `toMatchCriteria()` uses Claude API for semantic assertions:

```typescript
// Requires ANTHROPIC_API_KEY
await expect(response.text).toMatchCriteria('Contains a valid SQL query');
```

## Test Setup Pattern

```typescript
async function setup(options = {}) {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client({ name: 'test', version: '1.0' }, { capabilities: {} });
  const platform = createSupabaseApiPlatform({ apiUrl, accessToken });
  const server = createSupabaseMcpServer({ platform, ...options });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}
```
