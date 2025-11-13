# MCP Client Documentation System

This directory contains the automated documentation system for MCP client installation instructions.

## Files

- **`clients.json`** - Source of truth containing metadata for all MCP clients
- **`_template.md`** - Handlebars-style template used to generate client documentation
- **`*.md`** (generated, gitignored) - Individual client markdown files generated from the template

## Usage

### Adding a New Client

Use the interactive CLI to add a new client:

```bash
npm run docs:add-client
```

This will prompt you for:
- Client ID and name
- Installation methods (deeplink, CLI command, manual)
- Configuration details
- Official documentation URL

### Generating Documentation

After adding or modifying a client, regenerate the documentation:

```bash
npm run docs:generate-clients
```

This will:
1. Read `clients.json`
2. Generate individual `{client-id}.md` files from the template
3. Update the client documentation section in `README.md`

### Manual Editing

To manually add or edit a client:

1. Edit `docs/clients/clients.json` directly
2. Run `npm run docs:generate-clients`
3. Review the generated output
4. Commit `clients.json` and the updated `README.md`

## Client Data Schema

```typescript
{
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
      configFormat: "mcpServers" | "servers" | "custom";
      instructions?: string;
    };
  };
  registry?: {                   // Registry listing info
    listed: boolean;
    listingUrl?: string;
  };
}
```

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
