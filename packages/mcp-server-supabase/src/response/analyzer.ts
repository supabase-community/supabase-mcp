/**
 * Response analysis utilities for size detection and complexity assessment
 */

import type { ResponseAnalysis, ResponseChunkingConfig } from './types.js';

/**
 * Rough token estimation - approximates GPT tokenization
 * Generally: 1 token ≈ 4 characters for English text
 * JSON structure adds overhead, so we use a more conservative ratio
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Complexity factors for different data types
 */
const COMPLEXITY_WEIGHTS = {
  primitive: 0.1,
  simpleObject: 0.3,
  array: 0.5,
  nestedObject: 0.7,
  complexNested: 1.0,
} as const;

/**
 * Analyzes a response to determine its size, complexity, and chunking needs
 */
export function analyzeResponse(
  data: any,
  config: ResponseChunkingConfig
): ResponseAnalysis {
  const startTime = performance.now();

  try {
    // Convert to JSON string to get accurate size
    const jsonString = JSON.stringify(data);
    const characterCount = jsonString.length;
    const estimatedTokens = Math.ceil(characterCount / CHARS_PER_TOKEN);

    // Determine response type and get metrics
    const analysis = getResponseMetrics(data);

    // Calculate complexity score
    const complexity = calculateComplexity(data);

    // Determine if chunking is needed
    const shouldChunk = shouldApplyChunking(analysis, config);

    // Suggest appropriate strategy
    const suggestedStrategy = suggestChunkingStrategy(analysis, config);

    const processingTime = performance.now() - startTime;

    return {
      estimatedTokens,
      characterCount,
      responseType: analysis.type,
      arrayItemCount: analysis.arrayItemCount,
      objectPropertyCount: analysis.objectPropertyCount,
      complexity,
      suggestedStrategy,
      shouldChunk,
    };
  } catch (error) {
    // Fallback analysis if something goes wrong
    console.warn('[Response Analyzer] Analysis failed, using fallback:', error);

    // Try to get basic size info
    let characterCount = 0;
    let estimatedTokens = 0;

    try {
      const fallbackString = String(data);
      characterCount = fallbackString.length;
      estimatedTokens = Math.ceil(characterCount / CHARS_PER_TOKEN);
    } catch {
      // Ultimate fallback
      characterCount = 1000; // Assume medium size
      estimatedTokens = Math.ceil(characterCount / CHARS_PER_TOKEN);
    }

    return {
      estimatedTokens,
      characterCount,
      responseType: 'mixed',
      complexity: 0.5,
      suggestedStrategy: 'truncate',
      shouldChunk: estimatedTokens > config.maxTokens,
    };
  }
}

interface ResponseMetrics {
  type: 'array' | 'object' | 'primitive' | 'mixed';
  arrayItemCount?: number;
  objectPropertyCount?: number;
  maxDepth: number;
  hasNestedArrays: boolean;
  hasNestedObjects: boolean;
}

function getResponseMetrics(data: any): ResponseMetrics {
  if (Array.isArray(data)) {
    const analysis = analyzeArray(data);
    return {
      type: 'array',
      arrayItemCount: data.length,
      maxDepth: analysis.maxDepth,
      hasNestedArrays: analysis.hasNestedArrays,
      hasNestedObjects: analysis.hasNestedObjects,
    };
  }

  if (data && typeof data === 'object' && data !== null) {
    const analysis = analyzeObject(data);
    return {
      type: analysis.isComplex ? 'mixed' : 'object',
      objectPropertyCount: Object.keys(data).length,
      maxDepth: analysis.maxDepth,
      hasNestedArrays: analysis.hasNestedArrays,
      hasNestedObjects: analysis.hasNestedObjects,
    };
  }

  return {
    type: 'primitive',
    maxDepth: 0,
    hasNestedArrays: false,
    hasNestedObjects: false,
  };
}

function analyzeArray(arr: any[]): {
  maxDepth: number;
  hasNestedArrays: boolean;
  hasNestedObjects: boolean;
} {
  let maxDepth = 1;
  let hasNestedArrays = false;
  let hasNestedObjects = false;

  for (const item of arr) {
    if (Array.isArray(item)) {
      hasNestedArrays = true;
      const subAnalysis = analyzeArray(item);
      maxDepth = Math.max(maxDepth, subAnalysis.maxDepth + 1);
    } else if (item && typeof item === 'object') {
      hasNestedObjects = true;
      const subAnalysis = analyzeObject(item);
      maxDepth = Math.max(maxDepth, subAnalysis.maxDepth + 1);
    }
  }

  return { maxDepth, hasNestedArrays, hasNestedObjects };
}

function analyzeObject(obj: Record<string, any>): {
  maxDepth: number;
  hasNestedArrays: boolean;
  hasNestedObjects: boolean;
  isComplex: boolean;
} {
  let maxDepth = 1;
  let hasNestedArrays = false;
  let hasNestedObjects = false;
  let complexValueCount = 0;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      hasNestedArrays = true;
      complexValueCount++;
      const subAnalysis = analyzeArray(value);
      maxDepth = Math.max(maxDepth, subAnalysis.maxDepth + 1);
    } else if (value && typeof value === 'object') {
      hasNestedObjects = true;
      complexValueCount++;
      const subAnalysis = analyzeObject(value);
      maxDepth = Math.max(maxDepth, subAnalysis.maxDepth + 1);
    }
  }

  const isComplex = complexValueCount > Object.keys(obj).length * 0.3;

  return { maxDepth, hasNestedArrays, hasNestedObjects, isComplex };
}

function calculateComplexity(data: any): number {
  const metrics = getResponseMetrics(data);

  let complexity = 0;

  // Base complexity by type
  switch (metrics.type) {
    case 'primitive':
      complexity += COMPLEXITY_WEIGHTS.primitive;
      break;
    case 'object':
      complexity += COMPLEXITY_WEIGHTS.simpleObject;
      break;
    case 'array':
      complexity += COMPLEXITY_WEIGHTS.array;
      break;
    case 'mixed':
      complexity += COMPLEXITY_WEIGHTS.complexNested;
      break;
  }

  // Adjust for depth
  complexity *= 1 + (metrics.maxDepth - 1) * 0.2;

  // Adjust for size
  if (metrics.arrayItemCount && metrics.arrayItemCount > 100) {
    complexity *= 1.3;
  }
  if (metrics.objectPropertyCount && metrics.objectPropertyCount > 20) {
    complexity *= 1.2;
  }

  // Adjust for nested complexity
  if (metrics.hasNestedArrays && metrics.hasNestedObjects) {
    complexity *= 1.4;
  } else if (metrics.hasNestedArrays || metrics.hasNestedObjects) {
    complexity *= 1.2;
  }

  return Math.min(complexity, 1.0); // Cap at 1.0
}

function shouldApplyChunking(
  metrics: ResponseMetrics,
  config: ResponseChunkingConfig
): boolean {
  // Check array size
  if (metrics.arrayItemCount && metrics.arrayItemCount > config.maxArrayItems) {
    return true;
  }

  // Check object complexity
  if (
    metrics.objectPropertyCount &&
    metrics.objectPropertyCount > config.maxObjectProperties
  ) {
    return true;
  }

  // Check depth and nesting
  if (
    metrics.maxDepth > 3 &&
    (metrics.hasNestedArrays || metrics.hasNestedObjects)
  ) {
    return true;
  }

  return false;
}

function suggestChunkingStrategy(
  metrics: ResponseMetrics,
  config: ResponseChunkingConfig
): ResponseChunkingConfig['summaryStrategy'] {
  // For large arrays, pagination works well
  if (
    metrics.type === 'array' &&
    metrics.arrayItemCount &&
    metrics.arrayItemCount > config.maxArrayItems
  ) {
    return config.enablePagination ? 'paginate' : 'sample';
  }

  // For complex objects, summarization is best
  if (
    metrics.type === 'mixed' ||
    (metrics.objectPropertyCount &&
      metrics.objectPropertyCount > config.maxObjectProperties)
  ) {
    return 'summarize';
  }

  // For simple oversized data, sampling works
  if (metrics.type === 'array' || metrics.type === 'object') {
    return 'sample';
  }

  // Default to truncation
  return 'truncate';
}

/**
 * Quick size check without full analysis - for performance-critical paths
 */
export function isOversized(
  data: any,
  config: ResponseChunkingConfig
): boolean {
  try {
    if (data === null || data === undefined) {
      return false;
    }

    const jsonString = JSON.stringify(data);
    const characterCount = jsonString.length;
    const estimatedTokens = Math.ceil(characterCount / CHARS_PER_TOKEN);

    return (
      estimatedTokens > config.maxTokens ||
      characterCount > config.maxCharacters
    );
  } catch (error) {
    // If we can't serialize it, assume it's problematic and oversized
    return true;
  }
}

/**
 * Get a quick summary of response characteristics
 */
export function getResponseSummary(data: any): string {
  if (Array.isArray(data)) {
    const itemType = data.length > 0 ? typeof data[0] : 'unknown';
    return `Array of ${data.length} ${itemType} items`;
  }

  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    return `Object with ${keys.length} properties: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
  }

  return `${typeof data} value`;
}
