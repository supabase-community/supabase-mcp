import { z } from 'zod';
import type { SupabasePlatform } from './platform/types.js';
import { PLATFORM_INDEPENDENT_FEATURES } from './server.js';
import {
  currentFeatureGroupSchema,
  featureGroupSchema,
  type FeatureGroup,
} from './types.js';

export type ValueOf<T> = T[keyof T];

// UnionToIntersection<A | B> = A & B
export type UnionToIntersection<U> = (
  U extends unknown
    ? (arg: U) => 0
    : never
) extends (arg: infer I) => 0
  ? I
  : never;

// LastInUnion<A | B> = B
export type LastInUnion<U> = UnionToIntersection<
  U extends unknown ? (x: U) => 0 : never
> extends (x: infer L) => 0
  ? L
  : never;

// UnionToTuple<A, B> = [A, B]
export type UnionToTuple<T, Last = LastInUnion<T>> = [T] extends [never]
  ? []
  : [Last, ...UnionToTuple<Exclude<T, Last>>];

/**
 * Parses a key-value string into an object.
 *
 * @returns An object representing the key-value pairs
 *
 * @example
 * const result = parseKeyValueList("key1=value1\nkey2=value2");
 * console.log(result); // { key1: "value1", key2: "value2" }
 */
export function parseKeyValueList(data: string): { [key: string]: string } {
  return Object.fromEntries(
    data
      .split('\n')
      .map((item) => item.split(/=(.*)/)) // split only on the first '='
      .filter(([key]) => key) // filter out empty keys
      .map(([key, value]) => [key, value ?? '']) // ensure value is not undefined
  );
}

/**
 * Creates a unique hash from a JavaScript object.
 * @param obj - The object to hash
 * @param length - Optional length to truncate the hash (default: full length)
 */
export async function hashObject(
  obj: Record<string, any>,
  length?: number
): Promise<string> {
  // Sort object keys to ensure consistent output regardless of original key order
  const str = JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, any>>((result, key) => {
          result[key] = value[key];
          return result;
        }, {});
    }
    return value;
  });

  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  );

  // Convert to base64
  const base64Hash = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return base64Hash.slice(0, length);
}

/**
 * Parses and validates feature groups based on the platform's available features.
 */
export function parseFeatureGroups(
  platform: SupabasePlatform,
  features: string[]
) {
  // First pass: validate that all features are valid
  const desiredFeatures = z.set(featureGroupSchema).parse(new Set(features));

  // The platform implementation can define a subset of features
  const availableFeatures: FeatureGroup[] = [
    ...PLATFORM_INDEPENDENT_FEATURES,
    ...currentFeatureGroupSchema.options.filter((key) =>
      Object.keys(platform).includes(key)
    ),
  ];

  const availableFeaturesSchema = z.enum(
    availableFeatures as [string, ...string[]],
    {
      description: 'Available features based on platform implementation',
      errorMap: (issue, ctx) => {
        switch (issue.code) {
          case 'invalid_enum_value':
            return {
              message: `This platform does not support the '${issue.received}' feature group. Supported groups are: ${availableFeatures.join(', ')}`,
            };
          default:
            return { message: ctx.defaultError };
        }
      },
    }
  );

  // Second pass: validate the desired features against this platform's available features
  return z.set(availableFeaturesSchema).parse(desiredFeatures);
}
