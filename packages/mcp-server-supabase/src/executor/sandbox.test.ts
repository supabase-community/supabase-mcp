// src/executor/sandbox.test.ts
import { describe, expect, test, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { runExecuteCode, runSearchCode } from './sandbox.js';

const mockApi = (): ApiClient => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
});

describe('runSearchCode — functional', () => {
  test('returns filtered spec data', async () => {
    const spec = { paths: { '/v1/organizations': {}, '/v1/projects': {} } };
    const result = await runSearchCode(
      `return Object.keys(spec.paths).filter(p => p.includes('projects'))`,
      spec
    );
    expect(result).toEqual(['/v1/projects']);
  });

  test('host spec object is not mutated by isolate code', async () => {
    const spec = { paths: { '/v1/organizations': {} } };
    await runSearchCode(`spec.injected = true`, spec);
    expect((spec as any).injected).toBeUndefined();
  });

  test('terminates on infinite loop within timeout', async () => {
    await expect(runSearchCode(`while(true){}`, {}, 200)).rejects.toThrow();
  }, 5000);

  test('supports async code', async () => {
    const spec = { info: { title: 'Supabase API' } };
    const result = await runSearchCode(`return await Promise.resolve(spec.info.title)`, spec);
    expect(result).toBe('Supabase API');
  });
});

describe('runSearchCode — security', () => {
  // Ref: https://github.com/laverdet/isolated-vm#security

  test('Node.js process is not accessible inside the isolate', async () => {
    const result = await runSearchCode(
      `return typeof process === 'undefined' ? 'no process' : process.version`,
      {}
    );
    expect(result).toBe('no process');
  });

  test('require is not accessible inside the isolate', async () => {
    const result = await runSearchCode(`return typeof require`, {});
    expect(result).toBe('undefined');
  });

  test('prototype chain escape via constructor is blocked', async () => {
    // Classic: this.constructor.constructor('return process')()
    await expect(
      runSearchCode(
        `const fn = this.constructor.constructor('return process'); return fn().version`,
        {}
      )
    ).rejects.toThrow();
  });

  test('memory exhaustion is contained — host process survives', async () => {
    // Ref: "memoryLimit is more of a guideline — a determined attacker could use 2-3x"
    await expect(
      runSearchCode(
        `const s = []; const mb = 1024 * 1024; while (true) { const a = new Uint8Array(mb); a[0] = 1; s.push(a); }`,
        {},
        30_000
      )
    ).rejects.toThrow();
  }, 15_000);
});

describe('runExecuteCode — functional', () => {
  test('calls api.get and returns result', async () => {
    const api = mockApi();
    vi.mocked(api.get).mockResolvedValue([{ id: 'org-1', name: 'My Org' }]);

    const result = await runExecuteCode(`return api.get('/v1/organizations')`, api);

    expect(api.get).toHaveBeenCalledWith('/v1/organizations');
    expect(result).toEqual([{ id: 'org-1', name: 'My Org' }]);
  });

  test('project_id is available as a top-level variable', async () => {
    const api = mockApi();
    const result = await runExecuteCode(`return project_id`, api, { project_id: 'proj-ref' });
    expect(result).toBe('proj-ref');
  });

  test('can chain multiple api calls', async () => {
    const api = mockApi();
    vi.mocked(api.get)
      .mockResolvedValueOnce([{ id: 'org-1' }])
      .mockResolvedValueOnce([{ id: 'proj-1' }]);

    const result = await runExecuteCode(
      `
      const orgs = await api.get('/v1/organizations')
      const projects = await api.get('/v1/projects')
      return { orgs, projects }
      `,
      api
    );
    expect(result).toEqual({ orgs: [{ id: 'org-1' }], projects: [{ id: 'proj-1' }] });
  });

  test('terminates on infinite loop within timeout', async () => {
    const api = mockApi();
    await expect(runExecuteCode(`while(true){}`, api, {}, 200)).rejects.toThrow();
  }, 5000);
});

describe('runExecuteCode — security', () => {
  // Ref: https://github.com/laverdet/isolated-vm#security
  // Primary risk: ivm.Reference objects set as context globals can be used by untrusted
  // code as a springboard back into the Node.js process.
  // Fix: evalClosure binds References as $0-$4 scoped only to bootstrap — never as named globals.

  test('ivm Reference objects are not accessible as globals in the isolate', async () => {
    const api = mockApi();
    vi.mocked(api.get).mockResolvedValue([]);

    const result = await runExecuteCode(
      `
      return {
        hasApiGet:    typeof __api_get    !== 'undefined',
        hasApiPost:   typeof __api_post   !== 'undefined',
        hasApiPut:    typeof __api_put    !== 'undefined',
        hasApiPatch:  typeof __api_patch  !== 'undefined',
        hasApiDelete: typeof __api_delete !== 'undefined',
      }
      `,
      api
    );

    expect(result).toEqual({
      hasApiGet: false,
      hasApiPost: false,
      hasApiPut: false,
      hasApiPatch: false,
      hasApiDelete: false,
    });
  });

  test('Node.js process is not accessible inside the execute isolate', async () => {
    const api = mockApi();
    const result = await runExecuteCode(
      `return typeof process === 'undefined' ? 'no process' : process.version`,
      api
    );
    expect(result).toBe('no process');
  });

  test('prototype chain escape attempt is blocked in execute isolate', async () => {
    const api = mockApi();
    await expect(
      runExecuteCode(
        `const fn = this.constructor.constructor('return process'); return fn().version`,
        api
      )
    ).rejects.toThrow();
  });
});
