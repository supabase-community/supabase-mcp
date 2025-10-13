/**
 * Improved error handling for Supabase MCP Server
 *
 * Provides:
 * - Categorized errors for better debugging
 * - Actionable suggestions for users/LLMs
 * - Retryability hints
 * - Context-aware error messages
 */

export type ErrorCategory =
  | 'auth'
  | 'network'
  | 'permissions'
  | 'validation'
  | 'rate_limit'
  | 'not_found'
  | 'server'
  | 'client'
  | 'timeout'
  | 'unknown';

export interface ErrorContext {
  tool?: string;
  params?: Record<string, any>;
  projectId?: string;
  timestamp?: number;
  [key: string]: any;
}

export interface ErrorSuggestion {
  message: string;
  action?: 'retry' | 'fix_params' | 'check_permissions' | 'contact_support';
  learnMoreUrl?: string;
}

export class SupabaseToolError extends Error {
  public readonly category: ErrorCategory;
  public readonly retryable: boolean;
  public readonly suggestions: ErrorSuggestion[];
  public readonly context: ErrorContext;
  public readonly originalError?: any;

  constructor(
    message: string,
    options: {
      category: ErrorCategory;
      retryable?: boolean;
      suggestions?: ErrorSuggestion[];
      context?: ErrorContext;
      originalError?: any;
    }
  ) {
    super(message);
    this.name = 'SupabaseToolError';
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.suggestions = options.suggestions ?? [];
    this.context = options.context ?? {};
    this.originalError = options.originalError;

    // Maintain proper stack trace
    Error.captureStackTrace?.(this, SupabaseToolError);
  }

  /**
   * Convert to user-friendly message
   */
  toUserMessage(): string {
    const parts = [this.message];

    if (this.suggestions.length > 0) {
      parts.push('\nSuggestions:');
      this.suggestions.forEach((suggestion, index) => {
        parts.push(`  ${index + 1}. ${suggestion.message}`);
        if (suggestion.learnMoreUrl) {
          parts.push(`     Learn more: ${suggestion.learnMoreUrl}`);
        }
      });
    }

    if (this.retryable) {
      parts.push('\nThis operation can be retried.');
    }

    return parts.join('\n');
  }

  /**
   * Convert to JSON for logging
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      retryable: this.retryable,
      suggestions: this.suggestions,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Categorize an error based on its properties
 */
export function categorizeError(error: any): ErrorCategory {
  // Authentication errors
  if (
    error.status === 401 ||
    error.status === 403 ||
    error.message?.includes('unauthorized') ||
    error.message?.includes('authentication')
  ) {
    return 'auth';
  }

  // Permission errors
  if (
    error.status === 403 ||
    error.message?.includes('permission') ||
    error.message?.includes('forbidden') ||
    error.message?.includes('access denied')
  ) {
    return 'permissions';
  }

  // Rate limiting
  if (error.status === 429 || error.message?.includes('rate limit')) {
    return 'rate_limit';
  }

  // Not found
  if (error.status === 404 || error.message?.includes('not found')) {
    return 'not_found';
  }

  // Validation errors
  if (
    error.status === 400 ||
    error.status === 422 ||
    error.name === 'ValidationError' ||
    error.name === 'ZodError'
  ) {
    return 'validation';
  }

  // Client errors (4xx)
  if (error.status >= 400 && error.status < 500) {
    return 'client';
  }

  // Server errors (5xx)
  if (error.status >= 500 && error.status < 600) {
    return 'server';
  }

  // Network errors
  if (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNREFUSED' ||
    error.name === 'NetworkError' ||
    error.message?.includes('network') ||
    error.message?.includes('fetch')
  ) {
    return 'network';
  }

  // Timeout
  if (
    error.code === 'ETIMEDOUT' ||
    error.name === 'TimeoutError' ||
    error.message?.includes('timeout')
  ) {
    return 'timeout';
  }

  return 'unknown';
}

/**
 * Generate suggestions based on error category
 */
export function generateSuggestions(
  category: ErrorCategory,
  context: ErrorContext
): ErrorSuggestion[] {
  const suggestions: ErrorSuggestion[] = [];

  switch (category) {
    case 'auth':
      suggestions.push({
        message:
          'Check that your SUPABASE_ACCESS_TOKEN is valid and not expired',
        action: 'check_permissions',
      });
      suggestions.push({
        message: 'Verify you have access to this project',
        action: 'check_permissions',
      });
      break;

    case 'permissions':
      suggestions.push({
        message:
          'Check that your access token has the required permissions for this operation',
        action: 'check_permissions',
      });
      if (context.tool?.includes('execute_sql')) {
        suggestions.push({
          message:
            'Verify your database user has the necessary table/column permissions',
          action: 'check_permissions',
        });
      }
      break;

    case 'rate_limit':
      suggestions.push({
        message: 'Wait a few moments before retrying',
        action: 'retry',
      });
      suggestions.push({
        message: 'Consider reducing the frequency of requests',
      });
      break;

    case 'not_found':
      if (context.projectId) {
        suggestions.push({
          message: `Verify that project ID "${context.projectId}" exists and is accessible`,
          action: 'fix_params',
        });
      }
      suggestions.push({
        message: 'Check the resource identifier for typos',
        action: 'fix_params',
      });
      break;

    case 'validation':
      suggestions.push({
        message: 'Review the tool parameters for invalid or missing values',
        action: 'fix_params',
      });
      if (context.params) {
        const paramKeys = Object.keys(context.params);
        suggestions.push({
          message: `Parameters provided: ${paramKeys.join(', ')}`,
        });
      }
      break;

    case 'network':
    case 'timeout':
      suggestions.push({
        message: 'Check your internet connection',
        action: 'retry',
      });
      suggestions.push({
        message: 'The operation can be retried automatically',
        action: 'retry',
      });
      break;

    case 'server':
      suggestions.push({
        message: 'This appears to be a temporary server issue',
        action: 'retry',
      });
      suggestions.push({
        message: 'Try again in a few moments',
        action: 'retry',
      });
      break;

    default:
      suggestions.push({
        message: 'Check the error details for more information',
      });
  }

  return suggestions;
}

/**
 * Wrap an error with enhanced context and suggestions
 */
export function wrapError(
  error: any,
  context: ErrorContext
): SupabaseToolError {
  // Already a SupabaseToolError
  if (error instanceof SupabaseToolError) {
    return error;
  }

  const category = categorizeError(error);
  const suggestions = generateSuggestions(category, context);
  const retryable = ['network', 'timeout', 'rate_limit', 'server'].includes(
    category
  );

  // Extract meaningful message
  let message = error.message || 'An error occurred';
  if (context.tool) {
    message = `Error in ${context.tool}: ${message}`;
  }

  return new SupabaseToolError(message, {
    category,
    retryable,
    suggestions,
    context,
    originalError: error,
  });
}

/**
 * Create a validation error
 */
export function createValidationError(
  message: string,
  context?: ErrorContext
): SupabaseToolError {
  return new SupabaseToolError(message, {
    category: 'validation',
    retryable: false,
    suggestions: [
      {
        message: 'Review the tool parameters and correct any invalid values',
        action: 'fix_params',
      },
    ],
    context: context ?? {},
  });
}

/**
 * Create a permission error
 */
export function createPermissionError(
  message: string,
  context?: ErrorContext
): SupabaseToolError {
  return new SupabaseToolError(message, {
    category: 'permissions',
    retryable: false,
    suggestions: [
      {
        message: 'Check that you have the required permissions for this operation',
        action: 'check_permissions',
      },
    ],
    context: context ?? {},
  });
}

/**
 * Create an authentication error
 */
export function createAuthError(
  message: string,
  context?: ErrorContext
): SupabaseToolError {
  return new SupabaseToolError(message, {
    category: 'auth',
    retryable: false,
    suggestions: [
      {
        message: 'Verify your SUPABASE_ACCESS_TOKEN is valid',
        action: 'check_permissions',
      },
      {
        message: 'Check that the token has not expired',
      },
    ],
    context: context ?? {},
  });
}
