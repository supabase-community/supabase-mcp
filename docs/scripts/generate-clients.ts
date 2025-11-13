import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { Client } from '../clients/constants';
import { clients } from '../clients/constants';

/**
 * Simple Handlebars-style template parser
 * Supports: {{variable}}, {{#if condition}}, {{#each array}}, {{#unless condition}}
 */
class TemplateParser {
  private helpers: Record<string, (a: unknown, b: unknown) => boolean> = {
    eq: (a, b) => a === b,
  };

  parse(template: string, data: Client): string {
    let result = template;
    let previousResult = '';

    // Keep processing until no more changes (handles nested blocks)
    let iterations = 0;
    const maxIterations = 10;

    while (result !== previousResult && iterations < maxIterations) {
      previousResult = result;

      // Handle {{#if}} blocks
      result = this.handleIfBlocks(result, data);

      // Handle {{#each}} blocks
      result = this.handleEachBlocks(result, data);

      // Handle {{#unless}} blocks
      result = this.handleUnlessBlocks(result, data);

      iterations++;
    }

    // Handle {{variable}} replacements LAST
    result = this.replaceVariables(result, data);

    return result;
  }

  private replaceVariables(template: string, data: Client): string {
    return template.replace(/\{\{([^#\/}][^}]*)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      const value = this.getNestedValue(data, trimmedPath);
      return value !== undefined ? String(value) : match;
    });
  }

  private handleIfBlocks(template: string, data: Client): string {
    // Find and process {{#if}} blocks one at a time (innermost first)
    let result = template;
    let foundMatch = true;

    while (foundMatch) {
      foundMatch = false;

      // Find the innermost {{#if}} block (one without nested {{#if}} inside)
      const ifPattern = /\{\{#if ([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/;
      const match = result.match(ifPattern);

      if (match) {
        const [fullMatch, condition, content] = match;
        const trimmedCondition = condition.trim();

        // Check if there's a nested {{#if}} in the content
        if (!content.includes('{{#if')) {
          // No nested blocks, safe to process
          const parts = this.parseConditionalParts(content);

          let replacement = '';
          if (this.evaluateCondition(trimmedCondition, data)) {
            replacement = parts.ifContent;
          } else {
            // Check else if conditions
            for (const elseIf of parts.elseIfs) {
              if (this.evaluateCondition(elseIf.condition, data)) {
                replacement = elseIf.content;
                break;
              }
            }

            // Use else content if no conditions matched
            if (!replacement && parts.elseContent) {
              replacement = parts.elseContent;
            }
          }

          result = result.replace(fullMatch, replacement);
          foundMatch = true;
        } else {
          // Has nested blocks, try to find a deeper one
          // Look for {{#if}} that doesn't have another {{#if}} before its {{/if}}
          const deepPattern =
            /\{\{#if ([^}]+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/;
          const deepMatch = result.match(deepPattern);

          if (deepMatch) {
            const [fullMatch, condition, content] = deepMatch;
            const trimmedCondition = condition.trim();
            const parts = this.parseConditionalParts(content);

            let replacement = '';
            if (this.evaluateCondition(trimmedCondition, data)) {
              replacement = parts.ifContent;
            } else {
              for (const elseIf of parts.elseIfs) {
                if (this.evaluateCondition(elseIf.condition, data)) {
                  replacement = elseIf.content;
                  break;
                }
              }

              if (!replacement && parts.elseContent) {
                replacement = parts.elseContent;
              }
            }

            result = result.replace(fullMatch, replacement);
            foundMatch = true;
          }
        }
      }
    }

    return result;
  }

  private parseConditionalParts(content: string): {
    ifContent: string;
    elseIfs: Array<{ condition: string; content: string }>;
    elseContent: string | null;
  } {
    const result = {
      ifContent: '',
      elseIfs: [] as Array<{ condition: string; content: string }>,
      elseContent: null as string | null,
    };

    // Split by {{else if}} and {{else}}
    const elseIfRegex = /\{\{else if ([^}]+)\}\}/g;
    const elseRegex = /\{\{else\}\}/;

    let remaining = content;
    let match: RegExpExecArray | null;

    // Find first {{else if}} or {{else}}
    const firstElseIfMatch = elseIfRegex.exec(remaining);
    const firstElseMatch = elseRegex.exec(remaining);

    if (!firstElseIfMatch && !firstElseMatch) {
      // No else clauses, return entire content as if content
      result.ifContent = content;
      return result;
    }

    // Determine which comes first
    const firstElseIfIndex = firstElseIfMatch
      ? firstElseIfMatch.index
      : Number.POSITIVE_INFINITY;
    const firstElseIndex = firstElseMatch
      ? firstElseMatch.index
      : Number.POSITIVE_INFINITY;

    if (firstElseIfIndex < firstElseIndex) {
      // Process {{else if}} clauses
      result.ifContent = remaining.substring(0, firstElseIfIndex);
      remaining = remaining.substring(firstElseIfIndex);

      // Reset regex
      const elseIfRegex2 = /\{\{else if ([^}]+)\}\}/g;
      let lastIndex = 0;

      while ((match = elseIfRegex2.exec(remaining)) !== null) {
        const condition = match[1].trim();
        const startIndex = match.index + match[0].length;

        // Find the next {{else if}} or {{else}}
        const nextElseIfMatch = /\{\{else if ([^}]+)\}\}/.exec(
          remaining.substring(startIndex)
        );
        const nextElseMatch = /\{\{else\}\}/.exec(
          remaining.substring(startIndex)
        );

        let endIndex: number;
        if (nextElseIfMatch && nextElseMatch) {
          endIndex =
            startIndex + Math.min(nextElseIfMatch.index, nextElseMatch.index);
        } else if (nextElseIfMatch) {
          endIndex = startIndex + nextElseIfMatch.index;
        } else if (nextElseMatch) {
          endIndex = startIndex + nextElseMatch.index;
        } else {
          endIndex = remaining.length;
        }

        const elseIfContent = remaining.substring(startIndex, endIndex);
        result.elseIfs.push({ condition, content: elseIfContent });
        lastIndex = endIndex;
      }

      // Check for final {{else}}
      const finalElseMatch = /\{\{else\}\}/.exec(
        remaining.substring(lastIndex)
      );
      if (finalElseMatch) {
        result.elseContent = remaining.substring(
          lastIndex + finalElseMatch.index + finalElseMatch[0].length
        );
      }
    } else {
      // Only {{else}} clause
      result.ifContent = remaining.substring(0, firstElseIndex);
      result.elseContent = remaining.substring(
        firstElseIndex + (firstElseMatch?.[0].length || 0)
      );
    }

    return result;
  }

  private evaluateCondition(condition: string, data: Client): boolean {
    // Check for helper functions like (eq a b)
    if (condition.startsWith('(')) {
      const helperMatch = condition.match(/\((\w+)\s+([^)]+)\s+([^)]+)\)/);
      if (helperMatch) {
        const [, helper, arg1, arg2] = helperMatch;
        const value1 = this.getNestedValue(data, arg1.trim());
        const value2 = arg2.replace(/['"]/g, '').trim();
        const helperFn = this.helpers[helper];
        return helperFn ? helperFn(value1, value2) : false;
      }
    }

    const value = this.getNestedValue(data, condition);
    return Boolean(value);
  }

  private handleUnlessBlocks(template: string, data: Client): string {
    return template.replace(
      /\{\{#unless ([^}]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      (match, condition, content) => {
        const trimmedCondition = condition.trim();
        const value = this.getNestedValue(data, trimmedCondition);
        if (!value) {
          return content;
        }
        return '';
      }
    );
  }

  private handleEachBlocks(template: string, data: Client): string {
    return template.replace(
      /\{\{#each ([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (match, arrayPath, content) => {
        const trimmedPath = arrayPath.trim();
        const array = this.getNestedValue(data, trimmedPath);

        if (!Array.isArray(array)) {
          // Not an array, might be a single object - treat as single-item array
          if (array && typeof array === 'object') {
            return this.parseEachContent(content, [
              array as Record<string, unknown>,
            ]);
          }
          return '';
        }

        return this.parseEachContent(content, array);
      }
    );
  }

  private parseEachContent(
    content: string,
    array: Array<Record<string, unknown>>
  ): string {
    return array
      .map((item, index) => {
        let itemContent = content;

        // Set @last variable
        const isLast = index === array.length - 1;

        // Replace variables in the item
        itemContent = itemContent.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
          const trimmedPath = path.trim();

          // Handle special variables
          if (trimmedPath === '@last') {
            return String(isLast);
          }

          // Handle unless blocks within each
          const value = item[trimmedPath];
          return value !== undefined ? String(value) : match;
        });

        // Handle {{#unless @last}} blocks
        itemContent = itemContent.replace(
          /\{\{#unless @last\}\}([\s\S]*?)\{\{\/unless\}\}/g,
          (match, unlessContent) => {
            return isLast ? '' : unlessContent;
          }
        );

        return itemContent;
      })
      .join('');
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }
}

/**
 * Generate markdown documentation for a single client
 */
function generateClientMarkdown(
  client: Client,
  template: string
): { filename: string; content: string } {
  const parser = new TemplateParser();
  const content = parser.parse(template, client);

  return {
    filename: `${client.id}.md`,
    content,
  };
}

/**
 * Update README.md with generated client documentation
 */
function updateReadme(clients: Client[], generatedDocs: string[]): void {
  const readmePath = join(process.cwd(), 'README.md');
  const readme = readFileSync(readmePath, 'utf-8');

  // Find the section where client docs should be inserted
  // Look for "You can also manually install it on your favorite client."
  // followed by the client details blocks
  const marker = 'You can also manually install it on your favorite client.';
  const markerIndex = readme.indexOf(marker);

  if (markerIndex === -1) {
    console.error('Could not find insertion marker in README.md');
    process.exit(1);
  }

  // Find the end of the client documentation section
  // Look for the next ## heading after the marker
  const afterMarker = readme.substring(markerIndex + marker.length);
  const nextSectionMatch = afterMarker.match(/\n## /);

  if (!nextSectionMatch || nextSectionMatch.index === undefined) {
    console.error('Could not find end of client documentation section');
    process.exit(1);
  }

  const endIndex = markerIndex + marker.length + nextSectionMatch.index;

  // Build the new client documentation section
  const clientDocs = `\n\n${generatedDocs.join('\n\n')}`;

  // Replace the old section with the new one
  const newReadme =
    readme.substring(0, markerIndex + marker.length) +
    clientDocs +
    '\n' +
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
    console.log(`Generating documentation for ${client.name}...`);
    const { content } = generateClientMarkdown(client, template);
    generatedDocs.push(content.trim());

    // Optionally write individual client markdown files
    const clientDocPath = join(
      process.cwd(),
      'docs/clients',
      `${client.id}.md`
    );
    writeFileSync(clientDocPath, content, 'utf-8');
    console.log(`   Wrote ${client.id}.md`);
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
