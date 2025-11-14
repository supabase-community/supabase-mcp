/**
 * MCP Client definitions for documentation generation
 * This file is specific to this repo and generates client installation instructions
 */

import { stripIndent } from 'common-tags';

/**
 * Configuration for a deeplink installation button
 */
export interface DeeplinkConfig {
  url: string;
  buttonImage: string;
  buttonAlt: string;
}

/**
 * Command installation instructions as Markdown
 */
export interface CommandInstructions {
  /** Optional prerequisite step (Markdown formatted) */
  prerequisite?: string;
  /** Main installation command (Markdown formatted) */
  command: string;
  /** Optional follow-up steps (Markdown formatted) */
  followUp?: string[];
}

/**
 * Manual configuration setup
 */
export interface ManualConfig {
  configFilePath: string;
  /** Raw config snippet to display (JSON/YAML/etc) */
  snippet: string;
}

/**
 * Registry information for the client
 */
export interface RegistryConfig {
  listed: boolean;
  listingUrl?: string;
}

/**
 * An MCP client that supports the Supabase MCP server
 */
export interface Client {
  /** Unique identifier (lowercase-kebab-case) */
  key: string;
  /** Display name */
  label: string;
  /** Short description */
  description?: string;
  /** URL to official MCP documentation */
  officialDocsUrl?: string;
  /** Config file path for manual installation */
  configFile?: string;
  /** Config format for manual installation */
  configFormat?: 'mcpServers' | 'servers' | 'yaml-goose';

  /** Generate deeplink buttons (can return multiple) */
  generateDeeplinks?: (serverUrl: string) => DeeplinkConfig[];

  /** Generate command installation instructions as Markdown */
  generateCommandInstructions?: () => CommandInstructions;

  /** Generate manual config snippet */
  generateManualConfig?: () => ManualConfig;

  /** Registry information */
  registry?: RegistryConfig;
}

const SERVER_URL = 'https://mcp.supabase.com/mcp';

/**
 * List of all MCP clients that support the Supabase MCP server
 */
export const clients: Client[] = [
  {
    key: 'claude-code',
    label: 'Claude Code',
    officialDocsUrl: 'https://code.claude.com/docs/en/mcp',
    configFile: '.mcp.json',
    configFormat: 'mcpServers',
    generateCommandInstructions: () => ({
      command: stripIndent`
        Add the Supabase MCP server to Claude Code:

        \`\`\`bash
        claude mcp add --transport http supabase ${SERVER_URL}
        \`\`\`
      `,
      followUp: [
        'Type `/mcp` in Claude Code and follow the instructions to complete the OAuth authentication flow.',
      ],
    }),
    generateManualConfig: () => ({
      configFilePath: '.mcp.json',
      snippet: JSON.stringify(
        {
          mcpServers: {
            supabase: {
              type: 'http',
              url: SERVER_URL,
            },
          },
        },
        null,
        2
      ),
    }),
  },
  {
    key: 'cursor',
    label: 'Cursor',
    description: 'AI-powered code editor',
    officialDocsUrl: 'https://docs.cursor.com/context/mcp',
    configFile: '.cursor/mcp.json',
    configFormat: 'mcpServers',
    generateDeeplinks: () => [
      {
        url: `https://cursor.com/en/install-mcp?name=Supabase&config=eyJ1cmwiOiJodHRwczovL21jcC5zdXBhYmFzZS5jb20vbWNwIn0%3D`,
        buttonImage: 'https://cursor.com/deeplink/mcp-install-dark.svg',
        buttonAlt: 'Install in Cursor',
      },
    ],
    generateManualConfig: () => ({
      configFilePath: '.cursor/mcp.json',
      snippet: JSON.stringify(
        {
          mcpServers: {
            supabase: {
              type: 'http',
              url: SERVER_URL,
            },
          },
        },
        null,
        2
      ),
    }),
  },
  {
    key: 'vscode',
    label: 'VS Code',
    description: 'Visual Studio Code with GitHub Copilot',
    officialDocsUrl:
      'https://code.visualstudio.com/docs/copilot/customization/mcp-servers#_add-an-mcp-server',
    configFile: 'mcp.json',
    configFormat: 'servers',
    generateDeeplinks: () => [
      {
        url: `https://vscode.dev/redirect?url=vscode:mcp/install%3F%7B%22name%22%3A%22Supabase%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.supabase.com%2Fmcp%22%7D`,
        buttonImage:
          'https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF',
        buttonAlt: 'Install in VS Code',
      },
      {
        url: `https://insiders.vscode.dev/redirect?url=vscode-insiders:mcp/install%3F%7B%22name%22%3A%22Supabase%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.supabase.com%2Fmcp%22%7D`,
        buttonImage:
          'https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5',
        buttonAlt: 'Install in VS Code Insiders',
      },
    ],
    generateManualConfig: () => ({
      configFilePath: 'mcp.json',
      snippet: JSON.stringify(
        {
          servers: {
            supabase: {
              type: 'http',
              url: SERVER_URL,
            },
          },
        },
        null,
        2
      ),
    }),
  },
  {
    key: 'goose',
    label: 'Goose',
    officialDocsUrl:
      'https://block.github.io/goose/docs/category/getting-started',
    configFile: '~/.config/goose/config.yaml',
    configFormat: 'yaml-goose',
    generateDeeplinks: () => [
      {
        url: `goose://extension?type=streamable_http&url=https%3A%2F%2Fmcp.supabase.com%2Fmcp&id=supabase&name=Supabase&description=Connect%20your%20Supabase%20projects%20to%20AI%20assistants.%20Manage%20tables%2C%20query%20data%2C%20deploy%20Edge%20Functions%2C%20and%20interact%20with%20your%20Supabase%20backend%20directly%20from%20your%20MCP%20client.`,
        buttonImage:
          'https://block.github.io/goose/img/extension-install-dark.svg',
        buttonAlt: 'Install in Goose',
      },
    ],
    generateCommandInstructions: () => ({
      command: stripIndent`
        Start a Goose session with the Supabase extension:

        \`\`\`bash
        goose session --with-streamable-http-extension "${SERVER_URL}"
        \`\`\`
      `,
      followUp: [
        'If using the desktop app, see [Using Extensions](https://block.github.io/goose/docs/getting-started/using-extensions).',
      ],
    }),
    generateManualConfig: () => ({
      configFilePath: '~/.config/goose/config.yaml',
      snippet: stripIndent`
        extensions:
          supabase:
            available_tools: []
            bundled: null
            description: Connect your Supabase projects to AI assistants. Manage tables, query data, deploy Edge Functions, and interact with your Supabase backend directly from your MCP client.
            enabled: true
            env_keys: []
            envs: {}
            headers: {}
            name: Supabase
            timeout: 300
            type: streamable_http
            uri: ${SERVER_URL}
      `,
    }),
  },
  {
    key: 'factory',
    label: 'Factory',
    description: 'AI-powered code assistant',
    officialDocsUrl: 'https://docs.factory.ai/cli/configuration/mcp.md',
    configFile: '~/.factory/mcp.json',
    configFormat: 'mcpServers',
    generateCommandInstructions: () => ({
      command: stripIndent`
        Add the Supabase MCP server to Factory:

        \`\`\`bash
        droid mcp add supabase ${SERVER_URL} --type http
        \`\`\`
      `,
      followUp: [
        'Restart Factory or type `/mcp` within droid to complete the OAuth authentication flow.',
      ],
    }),
    generateManualConfig: () => ({
      configFilePath: '~/.factory/mcp.json',
      snippet: JSON.stringify(
        {
          mcpServers: {
            supabase: {
              type: 'http',
              url: SERVER_URL,
            },
          },
        },
        null,
        2
      ),
    }),
  },
];
