import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as Handlebars from 'handlebars';
import type { Client } from '../clients/constants';
import { clients } from '../clients/constants';

// Register the 'eq' helper for Handlebars
Handlebars.registerHelper('eq', (a, b) => a === b);

const SERVER_URL = 'https://mcp.supabase.com/mcp';

/**
 * Prepare client data for template rendering by calling generator functions
 */
function prepareClientData(client: Client) {
  return {
    key: client.key,
    label: client.label,
    description: client.description,
    officialDocsUrl: client.officialDocsUrl,
    configFile: client.configFile,
    configFormat: client.configFormat,
    serverUrl: SERVER_URL,
    registry: client.registry,
    // Call generator functions to get actual content
    deeplinks: client.generateDeeplinks?.(SERVER_URL),
    commandInstructions: client.generateCommandInstructions?.(),
    manualConfig: client.generateManualConfig?.(),
  };
}

/**
 * Generate markdown documentation for a single client
 */
function generateClientMarkdown(
  client: Client,
  template: string
): { filename: string; content: string } {
  const compiledTemplate = Handlebars.compile(template);
  const preparedData = prepareClientData(client);
  const content = compiledTemplate(preparedData);

  return {
    filename: `${client.key}.md`,
    content,
  };
}

/**
 * Update README.md with generated client documentation
 */
function updateReadme(clients: Client[], generatedDocs: string[]): void {
  const readmePath = join(process.cwd(), 'README.md');
  const readme = readFileSync(readmePath, 'utf-8');

  // Find the section between HTML comment markers
  const beginMarker = '<!-- BEGIN GENERATED:clients -->';
  const endMarker = '<!-- END GENERATED:clients -->';

  const beginIndex = readme.indexOf(beginMarker);
  const endIndex = readme.indexOf(endMarker);

  if (beginIndex === -1) {
    console.error('Could not find BEGIN marker in README.md');
    process.exit(1);
  }

  if (endIndex === -1) {
    console.error('Could not find END marker in README.md');
    process.exit(1);
  }

  // Build the new client documentation section
  const clientDocs = `\n\n${generatedDocs.join('\n\n')}\n\n`;

  // Replace the content between the markers
  const newReadme =
    readme.substring(0, beginIndex + beginMarker.length) +
    clientDocs +
    readme.substring(endIndex);

  writeFileSync(readmePath, newReadme, 'utf-8');
  console.log('Updated README.md with generated client documentation');
}

/**
 * Main generation function
 */
function main() {
  console.log('Generating MCP client documentation...\n');

  // Load template
  const templatePath = join(process.cwd(), 'docs/clients/_template.md');
  const template = readFileSync(templatePath, 'utf-8');

  // Generate documentation for each client
  const generatedDocs: string[] = [];

  for (const client of clients) {
    console.log(`Generating documentation for ${client.label}...`);
    const { content } = generateClientMarkdown(client, template);
    generatedDocs.push(content.trim());

    // Optionally write individual client markdown files
    const clientDocPath = join(
      process.cwd(),
      'docs/clients',
      `${client.key}.md`
    );
    writeFileSync(clientDocPath, content, 'utf-8');
    console.log(`   Wrote ${client.key}.md`);
  }

  // Update README.md
  console.log('\nUpdating README.md...');
  updateReadme(clients, generatedDocs);

  // Format all generated files with Biome
  console.log('\nFormatting files with Biome...');
  try {
    execSync('pnpm format', { cwd: process.cwd(), stdio: 'inherit' });
    console.log('Files formatted successfully');
  } catch (error) {
    console.warn('Warning: Failed to format files with Biome');
  }

  console.log(
    `\nSuccessfully generated documentation for ${clients.length} clients!`
  );
}

// Run the script
main();
