---
name: mcp-utils-server-patterns
description: MCP server creation patterns using mcp-utils. Use when creating new MCP servers, understanding the server factory, or working with tool/resource registration.
---

# Server Patterns

## Creating a Server

```typescript
import { createMcpServer, tool } from '@supabase/mcp-utils';
import { z } from 'zod';

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  tools: {
    my_tool: tool({
      description: 'Does something',
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ result: input }),
    }),
  },
});

await server.connect(transport);
```

## The `tool()` Helper

Preserves Zod schema types for strong typing:

```typescript
export function tool<Params extends z.ZodObject<any>, Result>(
  tool: Tool<Params, Result>
) {
  return tool;
}
```

## Tool Structure

```typescript
type Tool<Params, Result> = {
  description: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  parameters: Params;
  execute(params: z.infer<Params>): Promise<Result>;
};
```

## Dynamic Tool Registration

Tools can be a function for dynamic loading:

```typescript
const server = createMcpServer({
  name: 'my-server',
  tools: async () => {
    const tools = {};
    if (featureEnabled) {
      Object.assign(tools, getFeatureTools());
    }
    return tools;
  },
});
```

## StreamTransport for Testing

```typescript
const clientTransport = new StreamTransport();
const serverTransport = new StreamTransport();

clientTransport.readable.pipeTo(serverTransport.writable);
serverTransport.readable.pipeTo(clientTransport.writable);
```
