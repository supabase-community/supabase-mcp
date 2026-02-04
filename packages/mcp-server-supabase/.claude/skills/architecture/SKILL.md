---
name: mcp-server-supabase-architecture
description: Source structure, core layers, and data flow for the Supabase MCP server. Use when modifying the server structure, adding new tool domains, or understanding how components connect.
---

# Architecture Overview

## Source Structure

```
src/
├── server.ts                 # Main factory: createSupabaseMcpServer()
├── index.ts                  # Public exports
├── types.ts                  # Shared Zod schemas
├── tools/                    # MCP tool implementations by domain
│   ├── account-tools.ts      # list_organizations, get_project, create_project
│   ├── database-operation-tools.ts  # execute_sql, list_tables
│   ├── edge-function-tools.ts       # deploy_edge_function
│   ├── storage-tools.ts
│   ├── branching-tools.ts
│   ├── debugging-tools.ts
│   ├── development-tools.ts
│   └── docs-tools.ts
├── management-api/           # Supabase Management API client
│   ├── index.ts              # Client factory (openapi-fetch)
│   └── types.ts              # AUTO-GENERATED - do not edit
├── content-api/              # Documentation GraphQL API
├── pg-meta/                  # Database introspection SQL generators
├── platform/                 # Platform abstraction layer
│   ├── types.ts              # Operation interfaces
│   └── api-platform.ts       # Management API implementation
└── transports/
    └── stdio.ts              # CLI entry point
```

## Core Layers

1. **Server Layer** (`server.ts`) - MCP server factory, feature orchestration
2. **Tools Layer** (`tools/`) - Domain-grouped implementations using `tool()` helper
3. **Platform Layer** (`platform/`) - Abstraction over Supabase APIs
4. **API Clients** - Management API (openapi-fetch), Content API (GraphQL)

## Data Flow

```
AI Client → Stdio Transport → MCP Server → Tool Handler → Platform Operations → Supabase API
```

## Adding a New Tool Domain

1. Create `src/tools/new-domain-tools.ts`
2. Export `getNewDomainTools({ operations, readOnly })` function
3. Add operation interface to `platform/types.ts`
4. Implement operations in `platform/api-platform.ts`
5. Register in `server.ts` conditional tool loading
