# MCP Client Documentation System

This directory contains the automated documentation system for MCP client installation instructions.

## Files

- **`constants.ts`** - TypeScript source of truth containing metadata for all MCP clients
- **`_template.md`** - Handlebars-style template used to generate client documentation
- **`*.md`** (generated, gitignored) - Individual client markdown files generated from the template

## Usage

### Adding a New Client

To add a new client, edit `docs/clients/constants.ts`:

1. Open `docs/clients/constants.ts`
2. Add a new client object to the `clients` array following the `Client` interface
3. Run `npm run docs:generate-clients` to generate documentation
4. Review the generated output
5. Commit `constants.ts` and the updated `README.md`

Example client object:

```typescript
{
  id: 'my-client',
  name: 'My Client',
  description: 'A great MCP client',
  officialDocs: 'https://example.com/docs',
  installation: {
    deeplink: {
      url: 'myapp://install-mcp?url=...',
      buttonImage: 'https://example.com/badge.svg',
      buttonAlt: 'Install in My Client'
    },
    manual: {
      configFilePath: '~/.myapp/mcp.json',
      configFormat: 'mcpServers'
    }
  },
  registry: {
    listed: true,
    listingUrl: 'https://registry.example.com/supabase'
  }
}
```

### Generating Documentation

After adding or modifying a client, regenerate the documentation:

```bash
npm run docs:generate-clients
```

This will:
1. Read `constants.ts`
2. Type-check the TypeScript file
3. Generate individual `{client-id}.md` files from the template
4. Update the client documentation section in `README.md`
5. Format all files with Biome

## Client Data Schema

The schema is defined as TypeScript interfaces in `constants.ts`:

```typescript
interface Client {
  id: string;                    // Unique identifier (lowercase-kebab-case)
  name: string;                  // Display name
  description?: string;          // Short description
  officialDocs?: string;         // URL to official MCP documentation
  installation: {
    deeplink?: {                 // One-click installation button
      url: string;
      buttonImage: string;
      buttonAlt: string;
    } | Array<...>;              // Can be single or array for multiple buttons
    command?: {                  // CLI installation
      command: string;
      description?: string;
    };
    manual: {                    // Manual config (always required)
      configFilePath: string;
      configFormat: "mcpServers" | "servers";
    };
  };
  registry?: {                   // Registry listing info
    listed: boolean;
    listingUrl?: string;
  };
}
```

TypeScript provides compile-time validation, so any schema errors will be caught before generating documentation.

## Template Syntax

The `_template.md` file uses Handlebars-style syntax:

- `{{variable}}` - Variable substitution
- `{{#if condition}}...{{/if}}` - Conditional blocks
- `{{#if condition}}...{{else if condition2}}...{{else}}...{{/if}}` - Else-if chains
- `{{#each array}}...{{/each}}` - Loop over arrays
- `{{#unless condition}}...{{/unless}}` - Negative conditional
- `{{@last}}` - Special variable in loops (true for last item)
- `(eq a b)` - Helper function for equality comparison

## Standard Configuration

All clients use the same HTTP configuration:

```json
{
  "type": "http",
  "url": "https://mcp.supabase.com/mcp"
}
```

The template automatically wraps this in the appropriate config format (`mcpServers`, `servers`, or flat) based on the client's `configFormat` setting.

## Future Enhancements

This data structure can be published as an npm package (e.g., `@supabase/mcp-clients-registry`) to share client metadata with the Supabase documentation website and other tools.
