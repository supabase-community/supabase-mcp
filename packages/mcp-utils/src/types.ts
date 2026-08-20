/**
 * A web stream that can be both read from and written to.
 */
export interface DuplexStream<T> {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}

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
