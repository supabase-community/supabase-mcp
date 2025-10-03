/**
 * Simple token limit enforcer for MCP 25k token limit
 * Much more effective than complex chunking for our specific use case
 */

export interface SimpleLimiterConfig {
  maxTokens: number;
  maxArrayItems?: number;
  includeWarning?: boolean;
}

const DEFAULT_CONFIG: SimpleLimiterConfig = {
  maxTokens: 20000, // Stay well below 25k limit
  maxArrayItems: 50,
  includeWarning: true,
};

/**
 * Estimate token count (roughly 4 characters per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Aggressively limit response size to stay under token limits
 */
export function limitResponseSize<T>(
  data: T,
  context: string = '',
  config: Partial<SimpleLimiterConfig> = {}
): string {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Handle arrays by limiting items
  if (Array.isArray(data)) {
    return limitArrayResponse(data, context, finalConfig);
  }

  // Handle objects by limiting properties
  if (data && typeof data === 'object') {
    return limitObjectResponse(data, context, finalConfig);
  }

  // Handle primitives
  const result = JSON.stringify(data, null, 2);
  const tokens = estimateTokens(result);

  if (tokens > finalConfig.maxTokens) {
    const truncated = result.substring(0, finalConfig.maxTokens * 4);
    return createLimitedResponse(truncated + '...', context, tokens, finalConfig.maxTokens, finalConfig.includeWarning);
  }

  return result;
}

function limitArrayResponse<T>(
  data: T[],
  context: string,
  config: SimpleLimiterConfig
): string {
  const maxItems = config.maxArrayItems || 50;
  let limitedData = data;
  let wasLimited = false;

  // First, limit array size
  if (data.length > maxItems) {
    limitedData = data.slice(0, maxItems);
    wasLimited = true;
  }

  // Try to serialize and check token count
  let result = JSON.stringify(limitedData, null, 2);
  let tokens = estimateTokens(result);

  // If still too large, progressively reduce items
  if (tokens > config.maxTokens) {
    let itemCount = Math.min(maxItems, data.length);

    while (itemCount > 1 && tokens > config.maxTokens) {
      itemCount = Math.floor(itemCount * 0.7); // Reduce by 30% each iteration
      limitedData = data.slice(0, itemCount);
      result = JSON.stringify(limitedData, null, 2);
      tokens = estimateTokens(result);
      wasLimited = true;
    }

    // If single item is still too large, truncate its content
    if (itemCount === 1 && tokens > config.maxTokens) {
      const singleItem = limitObjectSize(data[0], Math.floor(config.maxTokens * 0.8));
      result = JSON.stringify([singleItem], null, 2);
      tokens = estimateTokens(result);
      wasLimited = true;
    }
  }

  return createLimitedResponse(
    result,
    context,
    estimateTokens(JSON.stringify(data, null, 2)),
    config.maxTokens,
    config.includeWarning,
    wasLimited ? {
      originalCount: data.length,
      limitedCount: limitedData.length,
      type: 'array'
    } : undefined
  );
}

function limitObjectResponse(
  data: any,
  context: string,
  config: SimpleLimiterConfig
): string {
  let result = JSON.stringify(data, null, 2);
  let tokens = estimateTokens(result);

  if (tokens <= config.maxTokens) {
    return result;
  }

  // Progressively remove properties or truncate values
  const limitedData = limitObjectSize(data, config.maxTokens);
  result = JSON.stringify(limitedData, null, 2);
  tokens = estimateTokens(result);

  return createLimitedResponse(
    result,
    context,
    estimateTokens(JSON.stringify(data, null, 2)),
    config.maxTokens,
    config.includeWarning,
    { type: 'object', wasLimited: true }
  );
}

function limitObjectSize(obj: any, maxTokens: number): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    // For arrays within objects, limit to 10 items
    if (obj.length > 10) {
      return obj.slice(0, 10);
    }
    return obj.map(item => limitObjectSize(item, Math.floor(maxTokens / obj.length)));
  }

  const limited: any = {};
  const entries = Object.entries(obj);
  const maxTokensPerProperty = Math.floor(maxTokens / entries.length);

  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.length > 200) {
      // Truncate long strings
      limited[key] = value.substring(0, 200) + '...';
    } else if (Array.isArray(value) && value.length > 5) {
      // Limit arrays to 5 items
      limited[key] = value.slice(0, 5);
    } else if (value && typeof value === 'object') {
      // Recursively limit nested objects
      limited[key] = limitObjectSize(value, Math.floor(maxTokensPerProperty * 0.8));
    } else {
      limited[key] = value;
    }
  }

  return limited;
}

function createLimitedResponse(
  content: string,
  context: string,
  originalTokens: number,
  maxTokens: number,
  includeWarning: boolean = true,
  limitInfo?: any
): string {
  if (!includeWarning) {
    return content;
  }

  const currentTokens = estimateTokens(content);
  const parts = [context];

  if (limitInfo) {
    if (limitInfo.type === 'array') {
      parts.push(`(showing ${limitInfo.limitedCount} of ${limitInfo.originalCount} items)`);
    } else if (limitInfo.type === 'object') {
      parts.push('(properties limited for size)');
    }
  }

  if (originalTokens > maxTokens) {
    parts.push(`(response size reduced from ~${originalTokens} to ~${currentTokens} tokens)`);
  }

  const header = parts.join(' ');

  return `${header}\n\n${content}`;
}