import {
  buildSchema,
  GraphQLError,
  GraphQLSchema,
  parse,
  validate,
  type DocumentNode,
} from 'graphql';
import { z } from 'zod';

export const graphqlRequestSchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export const graphqlResponseSuccessSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  errors: z.undefined(),
});

export const graphqlErrorSchema = z.object({
  message: z.string(),
  locations: z.array(
    z.object({
      line: z.number(),
      column: z.number(),
    })
  ),
});

export const graphqlResponseErrorSchema = z.object({
  data: z.undefined(),
  errors: z.array(graphqlErrorSchema),
});

export const graphqlResponseSchema = z.union([
  graphqlResponseSuccessSchema,
  graphqlResponseErrorSchema,
]);

export type GraphQLRequest = z.infer<typeof graphqlRequestSchema>;
export type GraphQLResponse = z.infer<typeof graphqlResponseSchema>;

export type QueryFn = (
  request: GraphQLRequest
) => Promise<Record<string, unknown>>;

export type QueryOptions = {
  validateSchema?: boolean;
};

export type GraphQLClientOptions = {
  /**
   * The URL of the GraphQL endpoint.
   */
  url: string;

  /**
   * A function that loads the GraphQL schema.
   * This will be used for validating future queries.
   *
   * A `query` function is provided that can be used to
   * execute GraphQL queries against the endpoint
   * (e.g. if the API itself allows querying the schema).
   */
  loadSchema?({ query }: { query: QueryFn }): Promise<string>;

  /**
   * Optional headers to include in the request.
   */
  headers?: Record<string, string>;
};

export class GraphQLClient {
  #url: string;
  #headers: Record<string, string>;

  /**
   * A promise that resolves when the schema is loaded via
   * the `loadSchema` function.
   *
   * Resolves to an object containing the raw schema source
   * string and the parsed GraphQL schema.
   *
   * Rejects if no `loadSchema` function was provided to
   * the constructor.
   */
  schemaLoaded: Promise<{
    /**
     * The raw GraphQL schema string.
     */
    source: string;

    /**
     * The parsed GraphQL schema.
     */
    schema: GraphQLSchema;
  }>;

  /**
   * Creates a new GraphQL client.
   */
  constructor(options: GraphQLClientOptions) {
    this.#url = options.url;
    this.#headers = options.headers ?? {};

    this.schemaLoaded =
      options
        .loadSchema?.({ query: this.#query.bind(this) })
        .then((source) => ({
          source,
          schema: buildSchema(source),
        })) ?? Promise.reject(new Error('No schema loader provided'));

    // Prevent unhandled promise rejections
    this.schemaLoaded.catch(() => {});
  }

  /**
   * Executes a GraphQL query against the provided URL.
   */
  async query(
    request: GraphQLRequest,
    options: QueryOptions = { validateSchema: false }
  ) {
    try {
      // Check that this is a valid GraphQL query
      const documentNode = parse(request.query);

      // Validate the query against the schema if requested
      if (options.validateSchema) {
        const { schema } = await this.schemaLoaded;
        const errors = validate(schema, documentNode);
        if (errors.length > 0) {
          throw new Error(
            `Invalid GraphQL query: ${errors.map((e) => e.message).join(', ')}`
          );
        }
      }

      return this.#query(request);
    } catch (error) {
      // Make it obvious that this is a GraphQL error
      if (error instanceof GraphQLError) {
        throw new Error(`Invalid GraphQL query: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Sets the User-Agent header for all requests.
   */
  setUserAgent(userAgent: string) {
    this.#headers['User-Agent'] = userAgent;
  }

  /**
   * Executes a GraphQL query against the provided URL.
   *
   * Does not validate the query against the schema.
   */
  async #query(request: GraphQLRequest) {
    const { query, variables } = request;

    const response = await fetch(this.#url, {
      method: 'POST',
      headers: {
        ...this.#headers,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Supabase Content API GraphQL schema: HTTP status ${response.status}`
      );
    }

    const json = await response.json();

    const { data, error } = graphqlResponseSchema.safeParse(json);

    if (error) {
      throw new Error(
        `Failed to parse Supabase Content API response: ${error.message}`
      );
    }

    if (data.errors) {
      throw new Error(
        `Supabase Content API GraphQL error: ${data.errors
          .map(
            (err) =>
              `${err.message} (line ${err.locations[0]?.line ?? 'unknown'}, column ${err.locations[0]?.column ?? 'unknown'})`
          )
          .join(', ')}`
      );
    }

    return data.data;
  }
}

/**
 * Extracts the fields from a GraphQL query document.
 */
export function getQueryFields(document: DocumentNode) {
  return document.definitions
    .filter((def) => def.kind === 'OperationDefinition')
    .flatMap((def) => {
      if (def.kind === 'OperationDefinition' && def.selectionSet) {
        return def.selectionSet.selections
          .filter((sel) => sel.kind === 'Field')
          .map((sel) => {
            if (sel.kind === 'Field') {
              return sel.name.value;
            }
            return null;
          })
          .filter(Boolean);
      }
      return [];
    });
}
