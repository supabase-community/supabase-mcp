import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { createSupabaseApiPlatform } from './api-platform.js';

describe('createSupabaseApiPlatform with custom fetch', () => {
  test('routes management API calls through custom fetch handler', async () => {
    const projects = [
      {
        id: 'proj1',
        ref: 'proj1',
        name: 'Test Project',
        organization_id: 'org1',
        organization_slug: 'org1',
        status: 'ACTIVE_HEALTHY',
        created_at: new Date().toISOString(),
        region: 'us-east-1',
      },
    ];

    const app = new Hono().get('/v1/projects', (c) => c.json(projects));

    const platform = createSupabaseApiPlatform({
      accessToken: 'test-token',
      fetch: app.fetch.bind(app),
    });

    // Destructure so TypeScript can narrow the type after the guard below.
    const { account } = platform;
    if (!account) {
      throw new Error('account should be defined on the API platform');
    }

    const result = await account.listProjects();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Test Project');
  });
});
