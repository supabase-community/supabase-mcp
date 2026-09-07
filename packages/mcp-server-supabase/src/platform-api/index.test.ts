import { afterEach, describe, expect, test, vi } from 'vitest';
import { createPlatformApiClient } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPlatformApiClient', () => {
  test('sends bearer authentication and custom headers', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetch);

    const client = createPlatformApiClient(
      'https://api.example.com',
      'access-token',
      { 'User-Agent': 'supabase-mcp/1.0.0' }
    );

    await client.GET('/platform/projects/{ref}/run-lints', {
      params: { path: { ref: 'project-ref' } },
    });

    const [request] = fetch.mock.calls[0];
    const sentRequest = new Request(request);

    expect(sentRequest.url).toBe(
      'https://api.example.com/platform/projects/project-ref/run-lints'
    );
    expect(sentRequest.headers.get('Authorization')).toBe(
      'Bearer access-token'
    );
    expect(sentRequest.headers.get('User-Agent')).toBe('supabase-mcp/1.0.0');
  });
});
