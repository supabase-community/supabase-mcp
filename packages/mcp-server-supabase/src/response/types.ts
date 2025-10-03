/**
 * Types and interfaces for response chunking and management system
 */

export interface ResponseChunkingConfig {
  /** Maximum estimated tokens before chunking kicks in */
  maxTokens: number;
  /** Maximum characters before chunking kicks in */
  maxCharacters: number;
  /** Maximum array items before chunking */
  maxArrayItems: number;
  /** Maximum object properties before field reduction */
  maxObjectProperties: number;
  /** Strategy for handling oversized responses */
  summaryStrategy: 'truncate' | 'sample' | 'summarize' | 'paginate';
  /** Enable pagination support where applicable */
  enablePagination: boolean;
  /** Show detailed metadata about chunking decisions */
  includeMetadata: boolean;
}

export interface ResponseMetadata {
  /** Total number of items in the original response */
  total_items?: number;
  /** Number of items in this chunk */
  chunk_size?: number;
  /** Whether more data is available */
  has_more?: boolean;
  /** Token for continuing pagination */
  continuation_token?: string;
  /** Original response size stats */
  original_size?: {
    characters: number;
    estimated_tokens: number;
    array_items?: number;
    object_properties?: number;
  };
  /** Chunking strategy applied */
  strategy_applied?: string;
  /** Fields that were omitted or summarized */
  omitted_fields?: string[];
  /** Number of object properties (for object responses) */
  object_properties?: number;
  /** Sampling information */
  sampling?: {
    method: 'first_n' | 'last_n' | 'random' | 'representative';
    sample_size: number;
    total_size: number;
  };
}

export interface ChunkedResponse<T = any> {
  /** Human-readable summary of the data */
  summary: string;
  /** The processed/chunked data */
  data: T;
  /** Metadata about the chunking process */
  metadata: ResponseMetadata;
  /** Warnings about data truncation or processing */
  warnings?: string[];
}

export interface ResponseAnalysis {
  /** Estimated token count using rough heuristics */
  estimatedTokens: number;
  /** Character count */
  characterCount: number;
  /** Type of response detected */
  responseType: 'array' | 'object' | 'primitive' | 'mixed';
  /** For arrays: item count */
  arrayItemCount?: number;
  /** For objects: property count */
  objectPropertyCount?: number;
  /** Complexity score (0-1, higher = more complex) */
  complexity: number;
  /** Suggested chunking strategy */
  suggestedStrategy: ResponseChunkingConfig['summaryStrategy'];
  /** Whether chunking is recommended */
  shouldChunk: boolean;
}

export type ChunkingStrategy =
  | 'array_pagination'
  | 'field_reduction'
  | 'sampling'
  | 'summarization'
  | 'truncation'
  | 'none';

export interface ChunkingResult<T = any> {
  strategy: ChunkingStrategy;
  result: ChunkedResponse<T>;
  processingTime: number;
}
