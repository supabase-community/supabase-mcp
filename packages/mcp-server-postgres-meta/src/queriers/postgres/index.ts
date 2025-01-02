import type { Querier } from '../types.js';
import postgres from 'postgres';

export type PostgresQuerierOptions = {
  connection: string;
};

/**
 * Creates a SQL querier using a direct Postgres connection.
 */
export function createPostgresQuerier(options: PostgresQuerierOptions) {
  return new PostgresQuerier(options);
}

export class PostgresQuerier implements Querier {
  readonly #client: postgres.Sql<{}>;

  constructor(options: PostgresQuerierOptions) {
    this.#client = postgres(options.connection);
  }

  async query<T>(query: string): Promise<T[]> {
    return await this.#client.unsafe<T[]>(query);
  }
}
