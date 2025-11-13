/**
 * MCP Client definitions
 * These are shared across documentation generation and external integrations
 */

export interface DeeplinkConfig {
  url: string;
  buttonImage: string;
  buttonAlt: string;
}

export interface CommandConfig {
  command: string;
  description?: string;
}

export interface ManualConfig {
  configFilePath: string;
  configFormat: 'mcpServers' | 'servers' | 'custom';
}

export interface RegistryConfig {
  listed: boolean;
  listingUrl?: string;
}

export interface ClientInstallation {
  deeplink?: DeeplinkConfig | DeeplinkConfig[];
  command?: CommandConfig;
  manual: ManualConfig;
}

export interface Client {
  id: string;
  name: string;
  description?: string;
  officialDocs?: string;
  installation: ClientInstallation;
  registry?: RegistryConfig;
}

/**
 * List of all MCP clients that support the Supabase MCP server
 */
export const clients: Client[] = [
  {
    id: 'goose',
    name: 'Goose',
    officialDocs: 'https://block.github.io/goose/docs/category/getting-started',
    installation: {
      deeplink: {
        url: 'ggoose://extension?type=streamable_http&url=https%3A%2F%2Fmcp.supabase.com%2Fmcp&id=supabase&name=Supabase&description=Connect%20your%20Supabase%20projects%20to%20AI%20assistants.%20Manage%20tables%2C%20query%20data%2C%20deploy%20Edge%20Functions%2C%20and%20interact%20with%20your%20Supabase%20backend%20directly%20from%20your%20MCP%20client.',
        buttonImage:
          'https://img.shields.io/badge/Goose-Goose?style=flat-square&label=Install%20Extension&color=F59E0B',
        buttonAlt: 'Install in Goose',
      },
      command: {
        command:
          'goose session --with-streamable-http-extension "https://mcp.supabase.com/mcp"',
        description:
          'If using the desktop app, see Using Extensions: https://block.github.io/goose/docs/getting-started/using-extensions',
      },
      manual: {
        configFilePath: '~/.config/goose/config.yaml',
        configFormat: 'custom',
      },
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    officialDocs: 'https://code.claude.com/docs/en/mcp',
    installation: {
      command: {
        command:
          'claude mcp add --transport http supabase https://mcp.supabase.com/mcp',
        description:
          'After adding the server, type `/mcp` in Claude Code and follow the instructions to complete the OAuth authentication flow.',
      },
      manual: {
        configFilePath: '.mcp.json',
        configFormat: 'mcpServers',
      },
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI-powered code editor',
    officialDocs: 'https://docs.cursor.com/context/mcp',
    installation: {
      deeplink: {
        url: 'https://cursor.com/en/install-mcp?name=Supabase&config=eyJ1cmwiOiJodHRwczovL21jcC5zdXBhYmFzZS5jb20vbWNwIn0%3D',
        buttonImage: 'https://cursor.com/deeplink/mcp-install-dark.svg',
        buttonAlt: 'Install in Cursor',
      },
      manual: {
        configFilePath: '.cursor/mcp.json',
        configFormat: 'mcpServers',
      },
    },
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Visual Studio Code with GitHub Copilot',
    officialDocs:
      'https://code.visualstudio.com/docs/copilot/customization/mcp-servers#_add-an-mcp-server',
    installation: {
      deeplink: [
        {
          url: 'https://vscode.dev/redirect?url=vscode:mcp/install%3F%7B%22name%22%3A%22Supabase%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.supabase.com%2Fmcp%22%7D',
          buttonImage:
            'https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF',
          buttonAlt: 'Install in VS Code',
        },
        {
          url: 'https://insiders.vscode.dev/redirect?url=vscode-insiders:mcp/install%3F%7B%22name%22%3A%22Supabase%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.supabase.com%2Fmcp%22%7D',
          buttonImage:
            'https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5',
          buttonAlt: 'Install in VS Code Insiders',
        },
      ],
      manual: {
        configFilePath: 'mcp.json',
        configFormat: 'servers',
      },
    },
  },
  {
    id: 'factory',
    name: 'Factory',
    description: 'AI-powered code assistant',
    officialDocs: 'https://docs.factory.ai/cli/configuration/mcp.md',
    installation: {
      command: {
        command:
          'droid mcp add supabase https://mcp.supabase.com/mcp --type http',
        description:
          'After adding the server, restart Factory or type `/mcp` within droid to complete the OAuth authentication flow.',
      },
      manual: {
        configFilePath: '~/.factory/mcp.json',
        configFormat: 'mcpServers',
      },
    },
  },
];
