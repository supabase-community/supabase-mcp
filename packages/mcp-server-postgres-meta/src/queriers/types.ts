export interface Querier {
  query<T>(query: string): Promise<T[]>;
}
