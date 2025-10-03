/**
 * Generic chunking system for handling oversized responses
 */

import type {
  ChunkedResponse,
  ResponseChunkingConfig,
  ChunkingResult,
  ChunkingStrategy,
  ResponseMetadata,
} from './types.js';
import { analyzeResponse, getResponseSummary } from './analyzer.js';

/**
 * Default configuration for response chunking
 */
export const DEFAULT_CHUNKING_CONFIG: ResponseChunkingConfig = {
  maxTokens: 4000, // Conservative limit for most LLMs
  maxCharacters: 15000, // Roughly corresponds to maxTokens
  maxArrayItems: 50, // Reasonable number of items to show at once
  maxObjectProperties: 30, // Manageable number of properties
  summaryStrategy: 'sample',
  enablePagination: true,
  includeMetadata: true,
};

/**
 * Main chunking function - processes any response data
 */
export function chunkResponse<T = any>(
  data: T,
  config: ResponseChunkingConfig = DEFAULT_CHUNKING_CONFIG
): ChunkingResult<T> {
  const startTime = performance.now();

  try {
    // Analyze the response
    const analysis = analyzeResponse(data, config);

    let strategy: ChunkingStrategy = 'none';
    let result: ChunkedResponse<T>;

    if (!analysis.shouldChunk) {
      // No chunking needed
      result = {
        summary: `Response: ${getResponseSummary(data)}`,
        data,
        metadata: {
          strategy_applied: 'none',
          original_size: {
            characters: analysis.characterCount,
            estimated_tokens: analysis.estimatedTokens,
            array_items: analysis.arrayItemCount,
            object_properties: analysis.objectPropertyCount,
          },
        },
      };
    } else {
      // Apply appropriate chunking strategy
      switch (analysis.suggestedStrategy) {
        case 'paginate':
          strategy = 'array_pagination';
          result = paginateArray(data, config);
          break;
        case 'sample':
          strategy = 'sampling';
          result = sampleData(data, config);
          break;
        case 'summarize':
          strategy = 'summarization';
          result = summarizeData(data, config);
          break;
        case 'truncate':
        default:
          strategy = 'truncation';
          result = truncateData(data, config);
          break;
      }

      // Add original size metadata
      result.metadata.original_size = {
        characters: analysis.characterCount,
        estimated_tokens: analysis.estimatedTokens,
        array_items: analysis.arrayItemCount,
        object_properties: analysis.objectPropertyCount,
      };
      result.metadata.strategy_applied = strategy;
    }

    const processingTime = performance.now() - startTime;

    return {
      strategy,
      result,
      processingTime,
    };
  } catch (error) {
    // Fallback to basic truncation if chunking fails
    const processingTime = performance.now() - startTime;
    console.warn(
      '[Response Chunker] Chunking failed, using fallback truncation:',
      error
    );

    return {
      strategy: 'truncation',
      result: truncateData(data, config),
      processingTime,
    };
  }
}

/**
 * Paginate array data - show first chunk with continuation info
 */
function paginateArray<T>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  if (!Array.isArray(data)) {
    return fallbackTruncation(data, config);
  }

  const chunkSize = Math.floor(config.maxArrayItems * 0.8); // Leave some buffer
  const firstChunk = data.slice(0, chunkSize);
  const hasMore = data.length > chunkSize;

  return {
    summary: `Showing ${firstChunk.length} of ${data.length} items${hasMore ? ' (pagination available)' : ''}`,
    data: firstChunk as T,
    metadata: {
      total_items: data.length,
      chunk_size: firstChunk.length,
      has_more: hasMore,
      continuation_token: hasMore ? `offset:${chunkSize}` : undefined,
      sampling: {
        method: 'first_n',
        sample_size: firstChunk.length,
        total_size: data.length,
      },
    },
    warnings: hasMore
      ? [`Only showing first ${chunkSize} items. Use pagination to see more.`]
      : undefined,
  };
}

/**
 * Sample data intelligently - show representative subset
 */
function sampleData<T>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  if (Array.isArray(data)) {
    return sampleArray(data, config);
  }

  if (data && typeof data === 'object') {
    return sampleObject(data, config);
  }

  return fallbackTruncation(data, config);
}

function sampleArray<T extends any[]>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  const targetSize = Math.floor(config.maxArrayItems * 0.6); // Conservative sampling

  if (data.length <= targetSize) {
    return {
      summary: `Array of ${data.length} items (complete)`,
      data,
      metadata: {},
    };
  }

  // Intelligent sampling: first few, last few, and some from middle
  const firstN = Math.floor(targetSize * 0.4);
  const lastN = Math.floor(targetSize * 0.3);
  const middleN = targetSize - firstN - lastN;

  const sample = [
    ...data.slice(0, firstN),
    ...(middleN > 0
      ? data.slice(
          Math.floor(data.length / 2) - Math.floor(middleN / 2),
          Math.floor(data.length / 2) + Math.ceil(middleN / 2)
        )
      : []),
    ...data.slice(-lastN),
  ];

  return {
    summary: `Representative sample: ${sample.length} of ${data.length} items (showing first ${firstN}, middle ${middleN}, last ${lastN})`,
    data: sample as T,
    metadata: {
      total_items: data.length,
      chunk_size: sample.length,
      has_more: true,
      sampling: {
        method: 'representative',
        sample_size: sample.length,
        total_size: data.length,
      },
    },
    warnings: [
      `Showing representative sample of ${sample.length}/${data.length} items. Full data available via pagination.`,
    ],
  };
}

function sampleObject<T extends Record<string, any>>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  const entries = Object.entries(data);
  const targetProps = Math.floor(config.maxObjectProperties * 0.8);

  if (entries.length <= targetProps) {
    return {
      summary: `Object with ${entries.length} properties (complete)`,
      data,
      metadata: {},
    };
  }

  // Prioritize important-looking properties (shorter names, common patterns)
  const prioritized = entries.sort(([a], [b]) => {
    const scoreA = getPropertyImportance(a);
    const scoreB = getPropertyImportance(b);
    return scoreB - scoreA;
  });

  const selectedEntries = prioritized.slice(0, targetProps);
  const omittedKeys = prioritized.slice(targetProps).map(([key]) => key);

  const sampledData = Object.fromEntries(selectedEntries) as T;

  return {
    summary: `Object with ${selectedEntries.length} of ${entries.length} properties (prioritized selection)`,
    data: sampledData,
    metadata: {
      object_properties: selectedEntries.length,
      omitted_fields: omittedKeys,
    },
    warnings: [
      `Showing ${selectedEntries.length}/${entries.length} properties. Omitted: ${omittedKeys.join(', ')}`,
    ],
  };
}

/**
 * Summarize complex data structures
 */
function summarizeData<T>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  if (Array.isArray(data)) {
    return summarizeArray(data, config);
  }

  if (data && typeof data === 'object') {
    return summarizeObject(data, config);
  }

  return fallbackTruncation(data, config);
}

function summarizeArray<T extends any[]>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  const sampleSize = Math.min(5, data.length);
  const sample = data.slice(0, sampleSize);

  // Create summary statistics
  const summary = {
    total_count: data.length,
    sample_items: sample,
    item_types: getArrayItemTypes(data),
    size_distribution: getArraySizeDistribution(data),
  };

  return {
    summary: `Array summary: ${data.length} items of types [${Object.keys(summary.item_types).join(', ')}]`,
    data: summary as unknown as T,
    metadata: {
      total_items: data.length,
      chunk_size: sampleSize,
      has_more: true,
      sampling: {
        method: 'first_n',
        sample_size: sampleSize,
        total_size: data.length,
      },
    },
    warnings: [
      `Showing summary and ${sampleSize} sample items. Full array has ${data.length} items.`,
    ],
  };
}

function summarizeObject<T extends Record<string, any>>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  const entries = Object.entries(data);
  const summary = {
    property_count: entries.length,
    property_types: getObjectPropertyTypes(data),
    sample_properties: getSampleProperties(data, 5),
    structure_summary: getObjectStructureSummary(data),
  };

  return {
    summary: `Object summary: ${entries.length} properties with types [${Object.keys(summary.property_types).join(', ')}]`,
    data: summary as unknown as T,
    metadata: {
      object_properties: entries.length,
    },
    warnings: [
      `Showing structural summary. Full object has ${entries.length} properties.`,
    ],
  };
}

/**
 * Truncate data as fallback strategy
 */
function truncateData<T>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  const jsonString = JSON.stringify(data);
  const targetLength = Math.floor(config.maxCharacters * 0.8);

  if (jsonString.length <= targetLength) {
    return {
      summary: `Data (${jsonString.length} characters)`,
      data,
      metadata: {},
    };
  }

  const truncated = jsonString.slice(0, targetLength);
  let parsedData: T;

  try {
    // Try to parse truncated JSON, might fail
    parsedData = JSON.parse(truncated + (truncated.endsWith('"') ? '' : '"'));
  } catch {
    // Fallback to string representation
    parsedData = (truncated + '... [truncated]') as T;
  }

  return {
    summary: `Truncated data (${truncated.length}/${jsonString.length} characters)`,
    data: parsedData,
    metadata: {
      original_size: {
        characters: jsonString.length,
        estimated_tokens: Math.ceil(jsonString.length / 3.5),
      },
    },
    warnings: [
      `Data truncated from ${jsonString.length} to ${truncated.length} characters.`,
    ],
  };
}

function fallbackTruncation<T>(
  data: T,
  config: ResponseChunkingConfig
): ChunkedResponse<T> {
  return truncateData(data, config);
}

// Utility functions

function getPropertyImportance(key: string): number {
  // Common important property patterns get higher scores
  const importantPatterns = [
    /^(id|name|title|type|status)$/i,
    /^(created|updated|modified).*at$/i,
    /^(is|has|can)_/i,
  ];

  let score = 100 - key.length; // Shorter names are generally more important

  for (const pattern of importantPatterns) {
    if (pattern.test(key)) {
      score += 50;
      break;
    }
  }

  return score;
}

function getArrayItemTypes(arr: any[]): Record<string, number> {
  const types: Record<string, number> = {};

  for (const item of arr) {
    const type = Array.isArray(item) ? 'array' : typeof item;
    types[type] = (types[type] || 0) + 1;
  }

  return types;
}

function getArraySizeDistribution(arr: any[]): {
  min: number;
  max: number;
  avg: number;
} {
  const sizes = arr.map((item) => JSON.stringify(item).length);
  return {
    min: Math.min(...sizes),
    max: Math.max(...sizes),
    avg: Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length),
  };
}

function getObjectPropertyTypes(
  obj: Record<string, any>
): Record<string, number> {
  const types: Record<string, number> = {};

  for (const value of Object.values(obj)) {
    const type = Array.isArray(value) ? 'array' : typeof value;
    types[type] = (types[type] || 0) + 1;
  }

  return types;
}

function getSampleProperties(
  obj: Record<string, any>,
  count: number
): Record<string, any> {
  const entries = Object.entries(obj);
  const sample = entries.slice(0, count);
  return Object.fromEntries(sample);
}

function getObjectStructureSummary(obj: Record<string, any>): string {
  const entries = Object.entries(obj);
  const complexProps = entries.filter(
    ([, value]) => typeof value === 'object' && value !== null
  ).length;

  return `${entries.length} total properties, ${complexProps} complex objects/arrays`;
}
