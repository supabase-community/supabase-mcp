/**
 * Retry middleware with exponential backoff
 *
 * Handles transient failures like:
 * - Network timeouts
 * - 429 Rate Limiting
 * - 500+ Server errors
 * - Connection resets
 */

export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial delay in milliseconds
   * @default 1000
   */
  initialDelay?: number;

  /**
   * Maximum delay in milliseconds
   * @default 10000
   */
  maxDelay?: number;

  /**
   * Backoff multiplier
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Add random jitter to prevent thundering herd
   * @default true
   */
  jitter?: boolean;

  /**
   * Predicate to determine if error is retryable
   */
  shouldRetry?: (error: any, attempt: number) => boolean;

  /**
   * Callback invoked before each retry
   */
  onRetry?: (error: any, attempt: number, delay: number) => void;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: any
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Default retry predicate - checks if error is retryable
 */
function defaultShouldRetry(error: any, attempt: number): boolean {
  // Don't retry if we've exhausted attempts
  if (attempt >= 3) return false;

  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') return true;

  // HTTP errors
  if (error.status) {
    // Rate limiting
    if (error.status === 429) return true;

    // Server errors (but not client errors)
    if (error.status >= 500 && error.status < 600) return true;
  }

  // Fetch API errors
  if (error.name === 'AbortError') return false; // User cancelled
  if (error.name === 'TypeError' && error.message.includes('fetch')) return true;

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>
): number {
  const { initialDelay, maxDelay, backoffMultiplier, jitter } = options;

  let delay = initialDelay * Math.pow(backoffMultiplier, attempt);
  delay = Math.min(delay, maxDelay);

  if (jitter) {
    // Add random jitter between 0-25% of delay
    const jitterAmount = delay * 0.25 * Math.random();
    delay += jitterAmount;
  }

  return Math.floor(delay);
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = {
    maxRetries: options.maxRetries ?? 3,
    initialDelay: options.initialDelay ?? 1000,
    maxDelay: options.maxDelay ?? 10000,
    backoffMultiplier: options.backoffMultiplier ?? 2,
    jitter: options.jitter ?? true,
    shouldRetry: options.shouldRetry ?? defaultShouldRetry,
    onRetry: options.onRetry ?? (() => {}),
  };

  let lastError: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt === opts.maxRetries || !opts.shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, opts);

      // Notify before retry
      opts.onRetry(error, attempt + 1, delay);

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript requires it
  throw new RetryError(
    `Failed after ${opts.maxRetries} retries`,
    opts.maxRetries,
    lastError
  );
}

/**
 * Create a retry wrapper for a function
 */
export function retryable<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options?: RetryOptions
): T {
  return (async (...args: Parameters<T>) => {
    return withRetry(() => fn(...args), options);
  }) as T;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract retry-after header from error response
 */
export function getRetryAfter(error: any): number | null {
  if (!error.headers) return null;

  const retryAfter = error.headers.get('retry-after');
  if (!retryAfter) return null;

  // Retry-After can be in seconds or HTTP date
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000; // Convert to milliseconds
  }

  // Try parsing as date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

/**
 * Retry with respect to Retry-After header (for rate limiting)
 */
export async function withRetryAfter<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return withRetry(fn, {
    ...options,
    shouldRetry: (error, attempt) => {
      // Check for rate limiting
      if (error.status === 429) {
        const retryAfter = getRetryAfter(error);
        if (retryAfter !== null && retryAfter < 60000) {
          // Only retry if Retry-After is less than 1 minute
          return true;
        }
      }
      return options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : defaultShouldRetry(error, attempt);
    },
    onRetry: (error, attempt, delay) => {
      // Override delay with Retry-After if present
      if (error.status === 429) {
        const retryAfter = getRetryAfter(error);
        if (retryAfter !== null) {
          // eslint-disable-next-line no-param-reassign
          delay = retryAfter;
        }
      }
      options.onRetry?.(error, attempt, delay);
    },
  });
}
