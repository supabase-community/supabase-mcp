# MCP Client Documentation System

This directory contains the automated documentation system for MCP client installation instructions.

## Files

- **`clients.ts`** - Client metadata with functions to generate installation instructions
- **`constants.ts`** - Re-exports client metadata for documentation scripts
- **`_template.md`** - Handlebars-style template used to generate client documentation
- **`*.md`** (generated, gitignored) - Individual client markdown files generated from the template

## Architecture

The client metadata is defined in `docs/clients/clients.ts` using a function-based approach. Each client has functions that generate:

- **Deeplink URLs**: Dynamic generation of installation buttons
- **Command instructions**: Markdown-formatted CLI installation steps with prerequisites and follow-ups
- **Manual configuration**: JSON/YAML snippets for manual setup

This function-based approach allows:

- **Flexible formatting**: Generate Markdown with proper formatting (code blocks, links, etc.)
- **Dynamic content**: Adapt instructions based on server URL or other parameters
- **Type safety**: TypeScript ensures all functions return correct structures
- **Single source of truth**: One place to maintain client configurations

## Usage

### Adding a New Client

To add a new client, edit `docs/clients/clients.ts`:

1. Open `docs/clients/clients.ts`
2. Add a new client object to the `clients` array following the `Client` interface
3. Implement the generator functions for your installation methods
4. Run `npm run docs:generate-clients` to generate documentation
5. Review the generated output
6. Commit the changes to both `clients.ts` and the updated `README.md`

Example client object:

```typescript
{
  key: 'my-client',
  label: 'My Client',
  description: 'A great MCP client',
  officialDocsUrl: 'https://example.com/docs',
  configFile: '~/.myapp/mcp.json',
  
  generateDeeplinks: (serverUrl) => [
    {
      url: `myapp://install-mcp?url=${encodeURIComponent(serverUrl)}`,
      buttonImage: 'https://example.com/badge.svg',
      buttonAlt: 'Install in My Client',
    },
  ],
  
  generateCommandInstructions: () => ({
    prerequisite: 'Install the CLI tool first: `npm install -g myapp-cli`',
    command: `Add the Supabase MCP server:

\`\`\`bash
myapp mcp add supabase ${serverUrl}
\`\`\``,
    followUp: [
      'Restart the app to complete setup.',
      'See the [official docs](https://example.com/docs) for more info.',
    ],
  }),
  
  generateManualConfig: () => ({
    configFilePath: '~/.myapp/mcp.json',
    snippet: JSON.stringify({
      mcpServers: {
        supabase: {
          type: 'http',
          url: serverUrl,
        },
      },
    }, null, 2),
  }),
  
  registry: {
    listed: true,
    listingUrl: 'https://registry.example.com/supabase',
  },
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

The schema is defined as TypeScript interfaces in `clients.ts`:

```typescript
interface Client {
  key: string;                       // Unique identifier (lowercase-kebab-case)
  label: string;                     // Display name
  description?: string;              // Short description
  officialDocsUrl?: string;          // URL to official MCP documentation
  configFile?: string;               // Config file path for manual installation
  
  // Generate deeplink buttons (can return multiple)
  generateDeeplinks?: (serverUrl: string) => DeeplinkConfig[];
  
  // Generate command installation instructions as Markdown
  generateCommandInstructions?: () => {
    prerequisite?: string;           // Optional pre-step (Markdown)
    command: string;                 // Main command (Markdown)
    followUp?: string[];             // Optional post-steps (Markdown)
  };
  
  // Generate manual config snippet
  generateManualConfig?: () => {
    configFilePath: string;
    snippet: string;                 // Raw JSON/YAML/etc
  };
  
  registry?: {                       // Registry listing info
    listed: boolean;
    listingUrl?: string;
  };
}
```

All instruction text is Markdown-formatted, allowing for:
- Inline code: `` `code` ``
- Code blocks: `` ```bash\ncommand\n``` ``
- Links: `[text](url)`
- Bold/italic: `**bold**`, `*italic*`

TypeScript provides compile-time validation, so any schema errors will be caught before generating documentation.

## Template Syntax

The `_template.md` file uses Handlebars-style syntax:

- `{{variable}}` - Variable substitution
- `{{#if condition}}...{{/if}}` - Conditional blocks
- `{{#if condition}}...{{else}}...{{/if}}` - If-else blocks
- `{{#each array}}...{{/each}}` - Loop over arrays
- `{{#unless condition}}...{{/unless}}` - Negative conditional
- `{{@last}}` - Special variable in loops (true for last item)
- `(eq a b)` - Helper function for equality comparison

When rendering, the generation script calls the client's generator functions to produce the actual content.

## Standard Configuration

All clients use the same HTTP server URL:

```
https://mcp.supabase.com/mcp
```

Each client's `generateManualConfig()` function returns the appropriate configuration format for that client.

## Future Enhancements

- Add more MCP clients as they add support
- Enhance generator functions to support more dynamic scenarios
- Add validation for generated content (e.g., ensure valid URLs, markdown syntax)
