import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';
import type { Client, ClientsData } from './types';
import { validateClientsData } from './types';

/**
 * Simple prompts implementation using readline
 */
class Prompter {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async text(message: string, defaultValue?: string): Promise<string> {
    return new Promise((resolve) => {
      const prompt = defaultValue
        ? `${message} (${defaultValue}): `
        : `${message}: `;

      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue || '');
      });
    });
  }

  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return new Promise((resolve) => {
      const defaultStr = defaultValue ? 'Y/n' : 'y/N';
      this.rl.question(`${message} (${defaultStr}): `, (answer) => {
        const normalized = answer.trim().toLowerCase();
        if (normalized === '') {
          resolve(defaultValue);
        } else {
          resolve(normalized === 'y' || normalized === 'yes');
        }
      });
    });
  }

  async select(
    message: string,
    choices: Array<{ value: string; title: string }>
  ): Promise<string> {
    console.log(`\n${message}`);
    choices.forEach((choice, index) => {
      console.log(`  ${index + 1}. ${choice.title}`);
    });

    return new Promise((resolve) => {
      this.rl.question('\nSelect number: ', (answer) => {
        const index = Number.parseInt(answer.trim(), 10) - 1;
        if (index >= 0 && index < choices.length) {
          resolve(choices[index].value);
        } else {
          console.log('Invalid selection, please try again.');
          this.select(message, choices).then(resolve);
        }
      });
    });
  }

  close() {
    this.rl.close();
  }
}

/**
 * Main add-client function
 */
async function main() {
  console.log('📝 Add a new MCP client to documentation\n');

  const prompter = new Prompter();

  try {
    // Load existing clients data
    const clientsPath = join(process.cwd(), 'docs/clients/clients.json');
    const rawData: unknown = JSON.parse(readFileSync(clientsPath, 'utf-8'));

    if (!validateClientsData(rawData)) {
      console.error('❌ Invalid existing clients.json data');
      process.exit(1);
    }

    const clientsData = rawData as ClientsData;

    // Collect client information
    const id = await prompter.text(
      'Client ID (lowercase, kebab-case, e.g., "cursor")'
    );
    if (!id) {
      console.error('❌ Client ID is required');
      process.exit(1);
    }

    // Check if client already exists
    if (clientsData.clients.some((c) => c.id === id)) {
      console.error(`❌ Client with ID "${id}" already exists`);
      process.exit(1);
    }

    const name = await prompter.text('Client name (e.g., "Cursor")');
    if (!name) {
      console.error('❌ Client name is required');
      process.exit(1);
    }

    const description = await prompter.text(
      'Client description (optional)',
      ''
    );
    const officialDocs = await prompter.text(
      'Official MCP documentation URL (optional)',
      ''
    );

    // Installation method selection
    console.log('\n📦 Installation Methods');
    const hasDeeplink = await prompter.confirm(
      'Does this client support deeplink installation?',
      false
    );

    let deeplinkConfigs: Array<{
      url: string;
      buttonImage: string;
      buttonAlt: string;
    }> = [];

    if (hasDeeplink) {
      let addMore = true;
      while (addMore) {
        const deeplinkUrl = await prompter.text('Deeplink URL');
        const buttonImage = await prompter.text('Button image URL');
        const buttonAlt = await prompter.text('Button alt text');

        if (deeplinkUrl && buttonImage && buttonAlt) {
          deeplinkConfigs.push({
            url: deeplinkUrl,
            buttonImage,
            buttonAlt,
          });
        }

        addMore = await prompter.confirm('Add another deeplink button?', false);
      }
    }

    const hasCommand = await prompter.confirm(
      'Does this client support CLI command installation?',
      false
    );

    let commandConfig: { command: string; description?: string } | undefined;

    if (hasCommand) {
      const command = await prompter.text('CLI installation command');
      const commandDescription = await prompter.text(
        'Command description (optional)',
        ''
      );

      if (command) {
        commandConfig = {
          command,
          ...(commandDescription && { description: commandDescription }),
        };
      }
    }

    // Manual installation (always required)
    console.log('\n📋 Manual Installation (required)');
    const configFilePath = await prompter.text(
      'Config file path (e.g., "mcp.json" or "~/.config/mcp.json")'
    );

    if (!configFilePath) {
      console.error('❌ Config file path is required');
      process.exit(1);
    }

    const configFormat = await prompter.select('Config format', [
      { value: 'mcpServers', title: 'mcpServers (nested object)' },
      { value: 'servers', title: 'servers (nested object)' },
      { value: 'custom', title: 'custom (flat object)' },
    ]);

    // Build the new client object
    const newClient: Client = {
      id,
      name,
      ...(description && { description }),
      ...(officialDocs && { officialDocs }),
      installation: {
        ...(deeplinkConfigs.length > 0 && {
          deeplink:
            deeplinkConfigs.length === 1 ? deeplinkConfigs[0] : deeplinkConfigs,
        }),
        ...(commandConfig && { command: commandConfig }),
        manual: {
          configFilePath,
          configFormat: configFormat as 'mcpServers' | 'servers' | 'custom',
        },
      },
    };

    // Add registry info
    const hasRegistry = await prompter.confirm(
      'Is this client listed in a registry?',
      false
    );

    if (hasRegistry) {
      const listingUrl = await prompter.text('Registry listing URL');
      newClient.registry = {
        listed: true,
        ...(listingUrl && { listingUrl }),
      };
    }

    // Preview the new client
    console.log('\n📄 Preview of new client:\n');
    console.log(JSON.stringify(newClient, null, 2));

    const confirm = await prompter.confirm(
      '\nAdd this client to clients.json?',
      true
    );

    if (!confirm) {
      console.log('❌ Cancelled');
      process.exit(0);
    }

    // Add to clients data
    clientsData.clients.push(newClient);

    // Sort by ID for consistency
    clientsData.clients.sort((a, b) => a.id.localeCompare(b.id));

    // Write back to file
    writeFileSync(
      clientsPath,
      JSON.stringify(clientsData, null, '\t'),
      'utf-8'
    );

    console.log(`\n✅ Successfully added ${name} to clients.json`);

    // Format the clients.json file with Biome
    console.log('\n📝 Formatting clients.json...');
    try {
      execSync(`pnpm biome check --write ${clientsPath}`, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      console.log('✓ File formatted successfully');
    } catch (error) {
      console.warn('⚠ Warning: Failed to format with Biome');
    }

    console.log('\n📝 Next steps:');
    console.log('  1. Run: npm run docs:generate-clients');
    console.log('  2. Review the generated documentation');
    console.log('  3. Commit your changes');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    prompter.close();
  }
}

// Run the script
main();
