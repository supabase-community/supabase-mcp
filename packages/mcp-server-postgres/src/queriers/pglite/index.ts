import { type PGliteInterface } from '@electric-sql/pglite';
import type { Querier } from '../types.js';

export type PGliteQuerierOptions = {
  pglite: PGliteInterface;
};

/**
 * Creates a SQL querier using PGlite.
 */
export function createPGliteQuerier(options: PGliteQuerierOptions) {
  return new PGliteQuerier(options);
}

export class PGliteQuerier implements Querier {
  readonly #client: PGliteInterface;

  constructor(options: PGliteQuerierOptions) {
    this.#client = options.pglite;
  }

  async query<T>(query: string): Promise<T[]> {
    return (await this.#client.exec(query)) as T[];
  }
}
