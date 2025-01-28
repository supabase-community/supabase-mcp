/**
 * Converts a union type to an intersection type.
 *
 * @example
 * type Union = 'a' | 'b' | 'c';
 * type Intersection = UnionToIntersection<Union>; // 'a' & 'b' & 'c'
 */
export type UnionToIntersection<U> = (
  U extends never ? never : (arg: U) => never
) extends (arg: infer I) => void
  ? I
  : never;

/**
 * Converts a union type to a tuple.
 *
 * @example
 * type Union = 'a' | 'b' | 'c';
 * type Tuple = UnionToTuple<Union>; // ['a', 'b', 'c']
 */
export type UnionToTuple<T> =
  UnionToIntersection<T extends never ? never : (t: T) => T> extends (
    _: never
  ) => infer W
    ? [...UnionToTuple<Exclude<T, W>>, W]
    : [];

/**
 * Extracts keys from an object and returns them as a tuple.
 *
 * @example
 * type Obj = { a: string, b: number };
 * type Keys = KeysToTuple<Obj>; // ['a', 'b']
 */
export type KeysToTuple<T extends Record<string, unknown>> = UnionToTuple<
  keyof T
>;

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

export interface ResultOk<T> {
  data: NonNullable<T>;
  error: null;
}

export interface ResultError<E> {
  data: null;
  error: NonNullable<E>;
}

export type Result<T, E> = ResultOk<T> | ResultError<E>;

export function isResultError<T, E>(
  result: Result<T, E>
): result is ResultError<E> {
  return result.error !== null;
}

/**
 * Unwraps a `{ data: T, error: unknown }` result, throwing an error if one is present
 * or returning the data if not.
 *
 * Supports both synchronous and asynchronous results, but will always return a promise.
 */
export async function unwrapResult<T, E>(
  result: Result<T, E> | Promise<Result<T, E>>
) {
  const resolved = await result;

  if (isResultError(resolved)) {
    throw resolved.error;
  }

  return resolved.data;
}
