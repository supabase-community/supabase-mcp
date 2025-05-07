import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * A web stream that can be both read from and written to.
 */
export interface DuplexStream<T> {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}

/**
 * Expands a type into its properties recursively.
 *
 * Useful for providing better intellisense in IDEs.
 */
export type ExpandRecursively<T> = T extends (...args: infer A) => infer R
  ? (...args: ExpandRecursively<A>) => ExpandRecursively<R>
  : T extends object
    ? T extends infer O
      ? { [K in keyof O]: ExpandRecursively<O[K]> }
      : never
    : T;

/**
 * Extracts parameter names from a string path.
 *
 * @example
 * type Path = '/schemas/{schema}/tables/{table}';
 * type Params = ExtractParams<Path>; // 'schema' | 'table'
 */
export type ExtractParams<Path extends string> =
  Path extends `${string}{${infer P}}${infer Rest}`
    ? P | ExtractParams<Rest>
    : never;

/**
 * Extracts the request type from an MCP server.
 */
export type ExtractRequest<S> = S extends Server<infer R, any, any> ? R : never;

/**
 * Extracts the notification type from an MCP server.
 */
export type ExtractNotification<S> = S extends Server<any, infer N, any>
  ? N
  : never;

/**
 * Extracts the result type from an MCP server.
 */
export type ExtractResult<S> = S extends Server<any, any, infer R> ? R : never;
