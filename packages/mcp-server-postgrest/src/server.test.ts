import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { describe, expect, test } from 'vitest';
import PostgrestMcpServer from './server.js';

// Requires local Supabase stack running
const API_URL = 'http://127.0.0.1:54321/rest/v1';

/**
 * Sets up a client and server for testing.
 */
async function setup() {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    {
      name: 'TestClient',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  const server = new PostgrestMcpServer({
    apiUrl: API_URL,
    schema: 'public',
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, clientTransport, server, serverTransport };
}

describe('resources', () => {
  test('list', async () => {
    const { client } = await setup();
    const { resources } = await client.listResources();

    expect(resources).toHaveLength(1);

    const [firstResource] = resources;

    if (!firstResource) {
      throw new Error('no resources');
    }

    expect(firstResource).toMatchInlineSnapshot(`
      {
        "description": "Table to manage todo items with details such as title, description, due date, and completion status.",
        "mimeType": "application/json",
        "name": ""todos" OpenAPI path spec",
        "uri": "postgrest://public/todos/spec",
      }
    `);
  });

  test('read', async () => {
    const { client } = await setup();
    const { contents } = await client.readResource({
      uri: 'postgrest://public/todos/spec',
    });

    const [firstContent] = contents;

    expect(firstContent).toMatchInlineSnapshot(`
      {
        "mimeType": "application/json",
        "text": "{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.todos.id"},{"$ref":"#/parameters/rowFilter.todos.title"},{"$ref":"#/parameters/rowFilter.todos.description"},{"$ref":"#/parameters/rowFilter.todos.due_date"},{"$ref":"#/parameters/rowFilter.todos.is_completed"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/todos"},"type":"array"}},"206":{"description":"Partial Content"}},"summary":"Table to manage todo items with details such as title, description, due date, and completion status.","tags":["todos"]},"post":{"parameters":[{"$ref":"#/parameters/body.todos"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"summary":"Table to manage todo items with details such as title, description, due date, and completion status.","tags":["todos"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.todos.id"},{"$ref":"#/parameters/rowFilter.todos.title"},{"$ref":"#/parameters/rowFilter.todos.description"},{"$ref":"#/parameters/rowFilter.todos.due_date"},{"$ref":"#/parameters/rowFilter.todos.is_completed"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"summary":"Table to manage todo items with details such as title, description, due date, and completion status.","tags":["todos"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.todos.id"},{"$ref":"#/parameters/rowFilter.todos.title"},{"$ref":"#/parameters/rowFilter.todos.description"},{"$ref":"#/parameters/rowFilter.todos.due_date"},{"$ref":"#/parameters/rowFilter.todos.is_completed"},{"$ref":"#/parameters/body.todos"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"summary":"Table to manage todo items with details such as title, description, due date, and completion status.","tags":["todos"]}}",
        "uri": "postgrest://public/todos/spec",
      }
    `);
  });
});

describe('tools', () => {
  test('list', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);

    const [firstTool] = tools;

    if (!firstTool) {
      throw new Error('no tools');
    }

    expect(firstTool).toMatchInlineSnapshot(`
      {
        "description": "Performs HTTP request against the PostgREST API",
        "inputSchema": {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "properties": {
            "body": {
              "additionalProperties": {},
              "type": "object",
            },
            "method": {
              "enum": [
                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
              ],
              "type": "string",
            },
            "path": {
              "type": "string",
            },
          },
          "required": [
            "method",
            "path",
          ],
          "type": "object",
        },
        "name": "postgrestRequest",
      }
    `);
  });

  test('execute', async () => {
    const { client } = await setup();
    const output = await client.callTool({
      name: 'postgrestRequest',
      arguments: {
        method: 'GET',
        path: '/todos?order=id.asc',
      },
    });

    const [firstContent] = output.content as any[];

    if (!firstContent) {
      throw new Error('no content');
    }

    const result = JSON.parse(firstContent.text);

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "description": "Purchase milk, eggs, and bread from the store",
          "due_date": "2023-10-15",
          "id": 1,
          "is_completed": false,
          "title": "Buy groceries",
        },
        {
          "description": "Finalize and submit the project report by the end of the week",
          "due_date": "2023-10-20",
          "id": 2,
          "is_completed": false,
          "title": "Complete project report",
        },
        {
          "description": "Annual check-up with Dr. Smith at 10 AM",
          "due_date": "2023-10-18",
          "id": 3,
          "is_completed": false,
          "title": "Doctor appointment",
        },
        {
          "description": "Fix the leaking sink in the kitchen",
          "due_date": "2023-10-16",
          "id": 4,
          "is_completed": false,
          "title": "Call plumber",
        },
        {
          "description": "Finish reading "The Great Gatsby"",
          "due_date": "2023-10-22",
          "id": 5,
          "is_completed": false,
          "title": "Read book",
        },
      ]
    `);
  });

  test('execute with body', async () => {
    const { client } = await setup();
    const output = await client.callTool({
      name: 'postgrestRequest',
      arguments: {
        method: 'POST',
        path: '/todos',
        body: {
          title: 'Test',
          description: 'Test',
          due_date: '2023-10-15',
          is_completed: false,
        },
      },
    });

    const [firstContent] = output.content as any[];

    if (!firstContent) {
      throw new Error('no content');
    }

    const [result] = JSON.parse(firstContent.text);

    expect(result).toMatchObject({
      title: 'Test',
      description: 'Test',
      due_date: '2023-10-15',
      is_completed: false,
    });

    // Clean up
    await client.callTool({
      name: 'postgrestRequest',
      arguments: {
        method: 'DELETE',
        path: `/todos?id=eq.${result.id}`,
      },
    });
  });
});
