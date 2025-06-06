/// <reference types="./extensions.d.ts" />

import { anthropic } from '@ai-sdk/anthropic';
import { StreamTransport } from '@supabase/mcp-utils';
import {
  experimental_createMCPClient as createMCPClient,
  generateText,
  type ToolCallUnion,
  type ToolSet,
} from 'ai';
import { codeBlock } from 'common-tags';
import { setupServer } from 'msw/node';
import { beforeEach, describe, expect, test } from 'vitest';
import { extractFiles } from '../src/eszip.js';
import { createSupabaseMcpServer } from '../src/index.js';
import { createSupabaseApiPlatform } from '../src/platform/api-platform.js';
import {
  ACCESS_TOKEN,
  API_URL,
  createOrganization,
  createProject,
  MCP_CLIENT_NAME,
  mockBranches,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from './mocks.js';

type SetupOptions = {
  projectId?: string;
};

/**
 * Sets up an MCP client and server for testing.
 */
async function setup({ projectId }: SetupOptions = {}) {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const platform = createSupabaseApiPlatform({
    apiUrl: API_URL,
    accessToken: ACCESS_TOKEN,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
  });

  await server.connect(serverTransport);

  const client = await createMCPClient({
    name: MCP_CLIENT_NAME,
    transport: clientTransport,
  });

  return { client, clientTransport, server, serverTransport };
}

beforeEach(async () => {
  mockOrgs.clear();
  mockProjects.clear();
  mockBranches.clear();

  const server = setupServer(...mockManagementApi);
  server.listen({ onUnhandledRequest: 'bypass' });
});

describe('llm tests', () => {
  test('identifies correct project before listing tables', async () => {
    const { client } = await setup();
    const model = anthropic('claude-3-7-sonnet-20250219');

    const org = await createOrganization({
      name: 'My Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const todosProject = await createProject({
      name: 'todos-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    const inventoryProject = await createProject({
      name: 'inventory-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    await todosProject.db.sql`create table todos (id serial, name text)`;
    await inventoryProject.db
      .sql`create table inventory (id serial, name text)`;

    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    const { text } = await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant. The current working directory is /home/user/projects/todos-app.',
        },
        {
          role: 'user',
          content: 'What tables do I have?',
        },
      ],
      maxSteps: 3,
      async onStepFinish({ toolCalls: tools }) {
        toolCalls.push(...tools);
      },
    });

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toEqual(
      expect.objectContaining({ toolName: 'list_projects' })
    );
    expect(toolCalls[1]).toEqual(
      expect.objectContaining({ toolName: 'list_tables' })
    );

    await expect(text).toMatchCriteria(
      'Describes a single table in the "todos-app" project called "todos"'
    );
  });

  test('deploys an edge function', async () => {
    const { client } = await setup();
    const model = anthropic('claude-3-7-sonnet-20250219');

    const org = await createOrganization({
      name: 'My Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const project = await createProject({
      name: 'todos-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    const { text } = await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant. The current working directory is /home/user/projects/todos-app.',
        },
        {
          role: 'user',
          content: `Deploy an edge function to project with ref ${project.id} that returns the current time in UTC.`,
        },
      ],
      maxSteps: 3,
      async onStepFinish({ toolCalls: tools }) {
        toolCalls.push(...tools);
      },
    });

    expect(toolCalls).toContainEqual(
      expect.objectContaining({ toolName: 'deploy_edge_function' })
    );

    await expect(text).toMatchCriteria(
      'Confirms the successful deployment of an edge function that will return the current time in UTC. It describes steps to test the function.'
    );
  });

  test('modifies an edge function', async () => {
    const { client } = await setup();
    const model = anthropic('claude-3-7-sonnet-20250219');

    const org = await createOrganization({
      name: 'My Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const project = await createProject({
      name: 'todos-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    const code = codeBlock`
      Deno.serve(async (req: Request) => {
        return new Response('Hello world!', { headers: { 'Content-Type': 'text/plain' } })
      })
    `;

    const edgeFunction = await project.deployEdgeFunction(
      {
        name: 'hello-world',
        entrypoint_path: 'index.ts',
      },
      [
        new File([code], 'index.ts', {
          type: 'application/typescript',
        }),
      ]
    );

    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    const { text } = await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant. The current working directory is /home/user/projects/todos-app.',
        },
        {
          role: 'user',
          content: `Change my edge function (project id ${project.id}) to replace "world" with "Earth".`,
        },
      ],
      maxSteps: 3,
      async onStepFinish({ toolCalls: tools }) {
        toolCalls.push(...tools);
      },
    });

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toEqual(
      expect.objectContaining({ toolName: 'list_edge_functions' })
    );
    expect(toolCalls[1]).toEqual(
      expect.objectContaining({ toolName: 'deploy_edge_function' })
    );

    await expect(text).toMatchCriteria(
      'Confirms the successful modification of an Edge Function.'
    );

    const files = await extractFiles(
      edgeFunction.eszip!,
      edgeFunction.pathPrefix
    );

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('index.ts');
    await expect(files[0].text()).resolves.toEqual(codeBlock`
      Deno.serve(async (req: Request) => {
        return new Response('Hello Earth!', { headers: { 'Content-Type': 'text/plain' } })
      })
    `);
  });

  test('project scoped server uses less tool calls', async () => {
    const org = await createOrganization({
      name: 'My Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const project = await createProject({
      name: 'todos-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    await project.db.sql`create table todos (id serial, name text)`;

    const { client } = await setup({ projectId: project.id });
    const model = anthropic('claude-3-7-sonnet-20250219');

    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    const { text } = await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant. The current working directory is /home/user/projects/todos-app.',
        },
        {
          role: 'user',
          content: `What tables do I have?`,
        },
      ],
      maxSteps: 2,
      async onStepFinish({ toolCalls: tools }) {
        toolCalls.push(...tools);
      },
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual(
      expect.objectContaining({ toolName: 'list_tables' })
    );

    await expect(text).toMatchCriteria(
      `Describes the a single todos table available in the project.`
    );
  });
});
