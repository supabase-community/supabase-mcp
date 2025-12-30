---
name: mcp-server-supabase-tools
description: Tool registration patterns for the Supabase MCP server. Use when creating new tools, modifying existing tools, or understanding how tools are registered with the server.
---

# Tool Registration Patterns

## Creating Tools

Tools use the `tool()` helper from `@supabase/mcp-utils`:

```typescript
import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';

export function getAccountTools({ account, readOnly }: AccountToolsOptions) {
  return {
    list_organizations: tool({
      description: 'Lists all organizations the user is a member of.',
      annotations: {
        title: 'List organizations',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({}),
      execute: async () => account.listOrganizations(),
    }),

    create_project: tool({
      description: 'Creates a new Supabase project.',
      annotations: {
        title: 'Create project',
        readOnlyHint: false,
        destructiveHint: false,
      },
      parameters: z.object({
        name: z.string(),
        organization_id: z.string(),
        region: z.enum(AWS_REGION_CODES),
      }),
      execute: async (params) => account.createProject(params),
    }),
  };
}
```

## Tool Annotations

- `readOnlyHint`: Tool doesn't modify state
- `destructiveHint`: Tool may delete/corrupt data
- `idempotentHint`: Calling multiple times has same effect
- `openWorldHint`: Tool interacts with external world

## Registering Tools in Server

Tools are conditionally registered in `server.ts`:

```typescript
const server = createMcpServer({
  name: 'supabase',
  tools: async () => {
    const tools: Record<string, Tool> = {};

    if (enabledFeatures.has('account') && account) {
      Object.assign(tools, getAccountTools({ account, readOnly }));
    }

    if (enabledFeatures.has('database') && database) {
      Object.assign(tools, getDatabaseOperationTools({ database, readOnly }));
    }

    return tools;
  },
});
```

## Read-Only Mode

When `readOnly: true`, tools that modify state should either:
1. Not be registered
2. Throw an error on execute
