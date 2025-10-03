/**
 * Response manager - main interface for handling large responses
 */

import { source } from 'common-tags';
import type {
  ResponseChunkingConfig,
  ChunkedResponse,
  ChunkingResult,
} from './types.js';
import { chunkResponse, DEFAULT_CHUNKING_CONFIG } from './chunker.js';
import { isOversized } from './analyzer.js';

/**
 * Response manager class - handles response processing and chunking
 */
export class ResponseManager {
  private config: ResponseChunkingConfig;

  constructor(config: Partial<ResponseChunkingConfig> = {}) {
    this.config = { ...DEFAULT_CHUNKING_CONFIG, ...config };
  }

  /**
   * Process a response, applying chunking if needed
   */
  processResponse<T>(data: T, context?: string): string {
    try {
      // Debug logging
      const dataString = JSON.stringify(data);
      const estimatedTokens = Math.ceil(dataString.length / 3.5);
      console.log(
        `[Response Manager] Processing data: ${dataString.length} chars, ~${estimatedTokens} tokens, config maxTokens: ${this.config.maxTokens}`
      );

      // Quick check if processing is needed
      const needsChunking = isOversized(data, this.config);
      console.log(`[Response Manager] Needs chunking: ${needsChunking}`);

      if (!needsChunking) {
        console.log('[Response Manager] Using simple response format');
        return this.formatSimpleResponse(data, context);
      }

      // Apply chunking
      console.log('[Response Manager] Applying chunking...');
      const result = chunkResponse(data, this.config);
      console.log(
        `[Response Manager] Chunking completed with strategy: ${result.strategy}`
      );
      return this.formatChunkedResponse(result, context);
    } catch (error) {
      // Fallback to simple formatting if chunking fails
      console.warn(
        '[Response Manager] Chunking failed, falling back to simple format:',
        error
      );
      return this.formatSimpleResponse(data, context);
    }
  }

  /**
   * Format a simple response that doesn't need chunking
   */
  private formatSimpleResponse<T>(data: T, context?: string): string {
    const contextText = context ? `${context}\n\n` : '';
    return source`
      ${contextText}${JSON.stringify(data, null, 2)}
    `;
  }

  /**
   * Format a chunked response with metadata and warnings
   */
  private formatChunkedResponse<T>(
    result: ChunkingResult<T>,
    context?: string
  ): string {
    const { result: chunked, strategy, processingTime } = result;
    const contextText = context ? `${context}\n\n` : '';

    // Build the response sections
    const sections: string[] = [];

    // Summary section
    sections.push(source`
      **Response Summary:** ${chunked.summary}
    `);

    // Main data section
    sections.push(source`
      **Data:**
      \`\`\`json
      ${JSON.stringify(chunked.data, null, 2)}
      \`\`\`
    `);

    // Metadata section (if enabled and has useful info)
    if (
      this.config.includeMetadata &&
      this.hasSignificantMetadata(chunked.metadata)
    ) {
      sections.push(this.formatMetadata(chunked.metadata));
    }

    // Warnings section
    if (chunked.warnings && chunked.warnings.length > 0) {
      sections.push(source`
        **⚠️ Important Notes:**
        ${chunked.warnings.map((warning) => `- ${warning}`).join('\n')}
      `);
    }

    // Continuation guidance
    if (chunked.metadata.has_more) {
      sections.push(this.formatContinuationGuidance(chunked.metadata));
    }

    return contextText + sections.join('\n\n');
  }

  /**
   * Format metadata information
   */
  private formatMetadata(metadata: ChunkedResponse['metadata']): string {
    const items: string[] = [];

    if (metadata.original_size) {
      items.push(
        `Original size: ${metadata.original_size.characters} chars (~${metadata.original_size.estimated_tokens} tokens)`
      );
    }

    if (metadata.strategy_applied && metadata.strategy_applied !== 'none') {
      items.push(`Processing: ${metadata.strategy_applied.replace('_', ' ')}`);
    }

    if (metadata.sampling) {
      const { method, sample_size, total_size } = metadata.sampling;
      items.push(`Sampling: ${method} (${sample_size}/${total_size})`);
    }

    if (metadata.omitted_fields && metadata.omitted_fields.length > 0) {
      items.push(
        `Omitted fields: ${metadata.omitted_fields.slice(0, 5).join(', ')}${metadata.omitted_fields.length > 5 ? '...' : ''}`
      );
    }

    if (items.length === 0) return '';

    return source`
      **Processing Details:**
      ${items.map((item) => `- ${item}`).join('\n')}
    `;
  }

  /**
   * Format continuation guidance for paginated responses
   */
  private formatContinuationGuidance(
    metadata: ChunkedResponse['metadata']
  ): string {
    if (!metadata.has_more) return '';

    const guidance: string[] = [];

    if (metadata.continuation_token) {
      guidance.push('Use pagination parameters to see more data');
    }

    if (metadata.total_items && metadata.chunk_size) {
      const remaining = metadata.total_items - metadata.chunk_size;
      guidance.push(`${remaining} more items available`);
    }

    guidance.push(
      'Consider adding LIMIT clauses to SQL queries for better performance'
    );

    return source`
      **Getting More Data:**
      ${guidance.map((item) => `- ${item}`).join('\n')}
    `;
  }

  /**
   * Check if metadata contains significant information worth showing
   */
  private hasSignificantMetadata(
    metadata: ChunkedResponse['metadata']
  ): boolean {
    return !!(
      metadata.original_size ||
      (metadata.strategy_applied && metadata.strategy_applied !== 'none') ||
      metadata.sampling ||
      (metadata.omitted_fields && metadata.omitted_fields.length > 0)
    );
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ResponseChunkingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): ResponseChunkingConfig {
    return { ...this.config };
  }
}

/**
 * Default response manager instance
 */
export const defaultResponseManager = new ResponseManager();

/**
 * Convenience function for processing responses
 */
export function processResponse<T>(
  data: T,
  context?: string,
  config?: Partial<ResponseChunkingConfig>
): string {
  if (config) {
    const manager = new ResponseManager(config);
    return manager.processResponse(data, context);
  }
  return defaultResponseManager.processResponse(data, context);
}

/**
 * Configuration presets for different use cases
 */
export const RESPONSE_CONFIGS = {
  /** Strict limits for token-conscious environments */
  CONSERVATIVE: {
    maxTokens: 2000,
    maxCharacters: 8000,
    maxArrayItems: 20,
    maxObjectProperties: 15,
    summaryStrategy: 'summarize' as const,
    includeMetadata: false,
  },

  /** Balanced settings for general use */
  STANDARD: DEFAULT_CHUNKING_CONFIG,

  /** More generous limits for detailed analysis */
  PERMISSIVE: {
    maxTokens: 8000,
    maxCharacters: 30000,
    maxArrayItems: 100,
    maxObjectProperties: 50,
    summaryStrategy: 'sample' as const,
    includeMetadata: true,
  },

  /** Optimized for database query results */
  DATABASE_RESULTS: {
    maxTokens: 2000,
    maxCharacters: 8000,
    maxArrayItems: 25,
    maxObjectProperties: 20,
    summaryStrategy: 'sample' as const,
    enablePagination: true,
    includeMetadata: true,
  },
} as const;
