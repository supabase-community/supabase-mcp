import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, retryable, getRetryAfter } from './retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = withRetry(fn);
    vi.runAllTimers();

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on network errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValue('success');

    const promise = withRetry(fn, { initialDelay: 100 });
    vi.advanceTimersByTime(100);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 500 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValue('success');

    const promise = withRetry(fn, { initialDelay: 100 });
    vi.advanceTimersByTime(100);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 429 rate limit', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue('success');

    const promise = withRetry(fn, { initialDelay: 100 });
    vi.advanceTimersByTime(100);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on 400 errors', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });

    const promise = withRetry(fn, { initialDelay: 100 });
    vi.runAllTimers();

    await expect(promise).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should respect maxRetries', async () => {
    const fn = vi.fn().mockRejectedValue({ code: 'ECONNRESET' });

    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 100 });
    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toEqual({ code: 'ECONNRESET' });
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn().mockRejectedValue({ code: 'ECONNRESET' });
    const delays: number[] = [];

    const onRetry = vi.fn((error, attempt, delay) => {
      delays.push(delay);
    });

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 1000,
      backoffMultiplier: 2,
      jitter: false,
      onRetry,
    });

    vi.runAllTimers();
    await expect(promise).rejects.toBeDefined();

    expect(delays).toHaveLength(3);
    expect(delays[0]).toBe(1000); // First retry
    expect(delays[1]).toBe(2000); // Second retry
    expect(delays[2]).toBe(4000); // Third retry
  });

  it('should respect maxDelay', async () => {
    const fn = vi.fn().mockRejectedValue({ code: 'ECONNRESET' });
    const delays: number[] = [];

    const promise = withRetry(fn, {
      maxRetries: 4,
      initialDelay: 1000,
      backoffMultiplier: 2,
      maxDelay: 3000,
      jitter: false,
      onRetry: (_, __, delay) => delays.push(delay),
    });

    vi.runAllTimers();
    await expect(promise).rejects.toBeDefined();

    expect(delays[2]).toBe(3000); // Capped at maxDelay
    expect(delays[3]).toBe(3000); // Capped at maxDelay
  });

  it('should call onRetry callback', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValue('success');

    const onRetry = vi.fn();

    const promise = withRetry(fn, { initialDelay: 100, onRetry });
    vi.advanceTimersByTime(100);

    await promise;
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ECONNRESET' }),
      1,
      expect.any(Number)
    );
  });
});

describe('retryable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should create retryable function', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValue('success');

    const retryableFn = retryable(fn, { initialDelay: 100 });

    const promise = retryableFn();
    vi.advanceTimersByTime(100);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('getRetryAfter', () => {
  it('should extract retry-after in seconds', () => {
    const error = {
      headers: new Map([['retry-after', '120']]),
    };

    const retryAfter = getRetryAfter(error);
    expect(retryAfter).toBe(120000); // 120 seconds = 120000 ms
  });

  it('should extract retry-after as HTTP date', () => {
    const futureDate = new Date(Date.now() + 60000); // 1 minute from now
    const error = {
      headers: new Map([['retry-after', futureDate.toUTCString()]]),
    };

    const retryAfter = getRetryAfter(error);
    expect(retryAfter).toBeGreaterThan(59000);
    expect(retryAfter).toBeLessThan(61000);
  });

  it('should return null for missing header', () => {
    const error = {
      headers: new Map(),
    };

    const retryAfter = getRetryAfter(error);
    expect(retryAfter).toBeNull();
  });

  it('should return null for no headers', () => {
    const error = {};

    const retryAfter = getRetryAfter(error);
    expect(retryAfter).toBeNull();
  });
});
