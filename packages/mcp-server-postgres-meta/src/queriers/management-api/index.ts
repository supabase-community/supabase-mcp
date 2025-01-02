import type { Querier } from '../types.js';
import {
  createManagementApiClient,
  type ManagementApiClient,
} from './client.js';

export type ManagementApiQuerierOptions = {
  projectRef: string;
  accessToken: string;
  apiUrl?: string;
};

/**
 * Creates a SQL querier using the Supabase Management API.
 */
export function createManagementApiQuerier(
  options: ManagementApiQuerierOptions
) {
  return new ManagementApiQuerier(options);
}

export class ManagementApiQuerier implements Querier {
  readonly #projectRef: string;
  readonly #client: ManagementApiClient;

  constructor(options: ManagementApiQuerierOptions) {
    this.#projectRef = options.projectRef;
    this.#client = createManagementApiClient(
      options.apiUrl ?? 'https://api.supabase.com',
      options.accessToken
    );
  }

  async query<T>(query: string): Promise<T[]> {
    const response = await this.#client.POST(
      '/v1/projects/{ref}/database/query',
      {
        params: {
          path: {
            ref: this.#projectRef,
          },
        },
        body: {
          query,
        },
      }
    );

    if (response.error) {
      throw new Error(response.error);
    }

    throw new Error(`here are the rows: ${JSON.stringify(response.data)}`);
  }
}
