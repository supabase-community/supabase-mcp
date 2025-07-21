/// <reference types="../extensions.d.ts" />

import { generateText, type ToolCallUnion, type ToolSet } from 'ai';
import { describe, expect, test } from 'vitest';
import { createOrganization, createProject } from '../mocks.js';
import { getTestModel, setup } from './utils.js';

describe('project management e2e tests', () => {
  test('identifies correct project before listing tables', async () => {
    const { client } = await setup();
    const model = getTestModel();

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
    const model = getTestModel();

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
      `Describes the single todos table available in the project.`
    );
  });

  test('should reject creating a project in read-only mode', async () => {
    const { client } = await setup({ readOnly: true });
    const model = getTestModel();

    const org = await createOrganization({
      name: 'test-org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    const { text } = await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content: 'You are a coding assistant.',
        },
        {
          role: 'user',
          content: `Create a new project named "todos-app" with organization_id ${org.id} in the region "us-east-1".`,
        },
      ],
      maxSteps: 3,
      async onStepFinish({ toolCalls: tools }) {
        toolCalls.push(...tools);
      },
    });

    expect(toolCalls).toHaveLength(3);
    expect(toolCalls[0]).toEqual(
      expect.objectContaining({ toolName: 'get_cost' })
    );
    expect(toolCalls[1]).toEqual(
      expect.objectContaining({ toolName: 'confirm_cost' })
    );
    expect(toolCalls[2]).toEqual(
      expect.objectContaining({ toolName: 'create_project' })
    );

    await expect(text).toMatchCriteria(
      'It is not possible to create a new project in read-only mode.'
    );
  });
});
