import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApiClient } from './client';

describe('createApiClient SSRF fix', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: vi.fn(async () => ({ success: true })),
      text: vi.fn(async () => '{"success": true}'),
    }));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should allow normal GET requests to /v1/projects', async () => {
    const api = createApiClient('token123', 'https://api.supabase.com');
    await api.get('/v1/projects');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.supabase.com/v1/projects');
  });

  it('should reject scheme-relative paths like //api.supabase.com.evil.com/steal', async () => {
    const api = createApiClient('token123', 'https://api.supabase.com');

    await expect(api.get('//api.supabase.com.evil.com/steal')).rejects.toThrow(
      /Only requests to https:\/\/api\.supabase\.com are permitted/
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should reject scheme-relative paths like //evil.com/x', async () => {
    const api = createApiClient('token123', 'https://api.supabase.com');

    await expect(api.get('//evil.com/x')).rejects.toThrow(
      /Only requests to https:\/\/api\.supabase\.com are permitted/
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should handle trailing slash in apiUrl correctly', async () => {
    const api = createApiClient('token123', 'https://api.supabase.com/');
    await api.get('/v1/projects');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.supabase.com/v1/projects');
  });

  it('should include Authorization header with bearer token', async () => {
    const api = createApiClient('secret-token', 'https://api.supabase.com');
    await api.get('/v1/projects');

    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBe('Bearer secret-token');
  });

  it('should successfully call onRequest callback after request', async () => {
    const onRequest = vi.fn();
    const api = createApiClient('token123', 'https://api.supabase.com', { onRequest });
    await api.get('/v1/projects');

    expect(onRequest).toHaveBeenCalledWith('GET', '/v1/projects');
  });
});
