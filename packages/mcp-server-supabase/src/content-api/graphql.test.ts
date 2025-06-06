import { stripIndent } from 'common-tags';
import { describe, expect, it } from 'vitest';
import { GraphQLClient } from './graphql.js';

describe('graphql client', () => {
  it('should load schema', async () => {
    const schema = stripIndent`
      schema {
        query: RootQueryType
      }
      type RootQueryType {
        message: String!
      }
    `;

    const graphqlClient = new GraphQLClient({
      url: 'dummy-url',
      loadSchema: async () => schema,
    });

    const { source } = await graphqlClient.schemaLoaded;

    expect(source).toBe(schema);
  });

  it('should throw error if validation requested but loadSchema not provided', async () => {
    const graphqlClient = new GraphQLClient({
      url: 'dummy-url',
    });

    await expect(
      graphqlClient.query(
        { query: '{ getHelloWorld }' },
        { validateSchema: true }
      )
    ).rejects.toThrow('No schema loader provided');
  });

  it('should throw for invalid query regardless of schema', async () => {
    const graphqlClient = new GraphQLClient({
      url: 'dummy-url',
    });

    await expect(
      graphqlClient.query({ query: 'invalid graphql query' })
    ).rejects.toThrow(
      'Invalid GraphQL query: Syntax Error: Unexpected Name "invalid"'
    );
  });

  it("should throw error if query doesn't match schema", async () => {
    const schema = stripIndent`
      schema {
        query: RootQueryType
      }
      type RootQueryType {
        message: String!
      }
    `;

    const graphqlClient = new GraphQLClient({
      url: 'dummy-url',
      loadSchema: async () => schema,
    });

    await expect(
      graphqlClient.query(
        { query: '{ invalidField }' },
        { validateSchema: true }
      )
    ).rejects.toThrow(
      'Invalid GraphQL query: Cannot query field "invalidField" on type "RootQueryType"'
    );
  });

  it('bubbles up loadSchema errors', async () => {
    const graphqlClient = new GraphQLClient({
      url: 'dummy-url',
      loadSchema: async () => {
        throw new Error('Failed to load schema');
      },
    });

    await expect(graphqlClient.schemaLoaded).rejects.toThrow(
      'Failed to load schema'
    );
  });
});
