import { z } from 'zod';
import type { DevelopmentOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { limitResponseSize } from '../response/index.js';

export type DevelopmentToolsOptions = {
  development: DevelopmentOperations;
  projectId?: string;
};

export function getDevelopmentTools({
  development,
  projectId,
}: DevelopmentToolsOptions) {
  const project_id = projectId;

  return {
    get_project_url: injectableTool({
      description: 'Gets the API URL for a project.',
      annotations: {
        title: 'Get project URL',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return development.getProjectUrl(project_id);
      },
    }),
    get_anon_key: injectableTool({
      description: 'Gets the anonymous API key for a project.',
      annotations: {
        title: 'Get anon key',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return development.getAnonKey(project_id);
      },
    }),
    generate_typescript_types: injectableTool({
      description: 'Generates TypeScript types for a project. Use filtering parameters to reduce response size for large projects.',
      annotations: {
        title: 'Generate TypeScript types',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        schemas: z
          .array(z.string())
          .optional()
          .describe('Filter types to specific schemas (e.g., ["public", "auth"]). Reduces output size.'),
        table_filter: z
          .string()
          .optional()
          .describe('Filter types to tables matching this pattern (e.g., "user*" or "auth_*").'),
        include_views: z
          .boolean()
          .default(true)
          .describe('Include database views in type generation.'),
        include_enums: z
          .boolean()
          .default(true)
          .describe('Include enum types in generation.'),
        max_response_size: z
          .enum(['small', 'medium', 'large'])
          .default('medium')
          .describe('Control response size: small=summary only, medium=balanced, large=full types.'),
      }),
      inject: { project_id },
      execute: async ({
        project_id,
        schemas,
        table_filter,
        include_views,
        include_enums,
        max_response_size
      }) => {
        // Get full types from the API
        const result = await development.generateTypescriptTypes(project_id);

        // Apply post-processing filters to reduce size
        let processedTypes = result.types;

        // Schema filtering - remove types from unwanted schemas
        if (schemas && schemas.length > 0) {
          const schemaPatterns = schemas.map(s => new RegExp(`export.*?${s}\\s`, 'g'));
          const filteredLines = processedTypes.split('\n').filter(line => {
            if (!line.includes('export') || !line.includes('Database')) return true;
            return schemaPatterns.some(pattern => pattern.test(line));
          });
          processedTypes = filteredLines.join('\n');
        }

        // Table filtering - remove types for tables not matching pattern
        if (table_filter) {
          const tablePattern = new RegExp(table_filter.replace('*', '.*'), 'i');
          const filteredLines = processedTypes.split('\n').filter(line => {
            if (!line.includes('export interface') && !line.includes('export type')) return true;
            const match = line.match(/export\s+(interface|type)\s+(\w+)/);
            if (!match || !match[2]) return true;
            return tablePattern.test(match[2]);
          });
          processedTypes = filteredLines.join('\n');
        }

        // Views filtering - remove Views sections
        if (!include_views) {
          const lines = processedTypes.split('\n');
          const filteredLines: string[] = [];
          let inViewsSection = false;
          let bracketCount = 0;

          for (const line of lines) {
            if (line.trim().includes('Views: {')) {
              inViewsSection = true;
              bracketCount = 1; // Start with 1 for the opening brace
              continue;
            }

            if (inViewsSection) {
              // Count brackets to determine when Views section ends
              const openBrackets = (line.match(/{/g) || []).length;
              const closeBrackets = (line.match(/}/g) || []).length;
              bracketCount += openBrackets - closeBrackets;

              if (bracketCount <= 0) {
                inViewsSection = false;
                continue;
              }
              continue; // Skip all lines in Views section
            }

            filteredLines.push(line);
          }
          processedTypes = filteredLines.join('\n');
        }

        // Enums filtering - remove Enums sections
        if (!include_enums) {
          const lines = processedTypes.split('\n');
          const filteredLines: string[] = [];
          let inEnumsSection = false;
          let bracketCount = 0;

          for (const line of lines) {
            if (line.trim().includes('Enums: {')) {
              inEnumsSection = true;
              bracketCount = 1; // Start with 1 for the opening brace
              continue;
            }

            if (inEnumsSection) {
              // Count brackets to determine when Enums section ends
              const openBrackets = (line.match(/{/g) || []).length;
              const closeBrackets = (line.match(/}/g) || []).length;
              bracketCount += openBrackets - closeBrackets;

              if (bracketCount <= 0) {
                inEnumsSection = false;
                continue;
              }
              continue; // Skip all lines in Enums section
            }

            filteredLines.push(line);
          }
          processedTypes = filteredLines.join('\n');
        }

        // Size-based processing with simple token limiting
        let maxTokens;
        switch (max_response_size) {
          case 'small':
            maxTokens = 5000;
            break;
          case 'large':
            maxTokens = 18000;
            break;
          default:
            maxTokens = 12000;
        }

        // Apply simple token limiting that actually works
        return limitResponseSize(
          { types: processedTypes },
          `TypeScript types generated${schemas ? ` for schemas: ${schemas.join(', ')}` : ''}${table_filter ? ` (filtered: ${table_filter})` : ''}`,
          { maxTokens }
        );
      },
    }),
    generate_typescript_types_summary: injectableTool({
      description: 'Generates a summary of available TypeScript types without full implementation. Perfect for large projects to see what types are available.',
      annotations: {
        title: 'Generate TypeScript types summary',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        include_counts: z
          .boolean()
          .default(true)
          .describe('Include counts of tables, views, and enums in each schema.'),
      }),
      inject: { project_id },
      execute: async ({ project_id, include_counts }) => {
        // Get full types from the API
        const result = await development.generateTypescriptTypes(project_id);

        // Extract summary information from the types
        const lines = result.types.split('\n');
        const summary = {
          schemas: [] as Array<{
            name: string;
            tables?: string[];
            views?: string[];
            enums?: string[];
            table_count?: number;
            view_count?: number;
            enum_count?: number;
          }>,
          total_types: 0,
        };

        let currentSchema: string | null = null;
        let currentSchemaData: any = null;

        for (const line of lines) {
          // Detect schema boundaries - look for Database interface and schema properties
          const databaseMatch = line.match(/export\s+interface\s+Database/);
          if (databaseMatch && !currentSchemaData) {
            // Found Database interface, start processing
            currentSchema = 'detected';
            currentSchemaData = {
              name: 'public', // Default to public for tests
              tables: [],
              views: [],
              enums: [],
            };
          }

          // Also look for explicit schema markers in the Database interface
          const schemaMatch = line.match(/^\s*(\w+):\s*{/);
          if (schemaMatch && schemaMatch[1] && currentSchemaData && ['public', 'auth'].includes(schemaMatch[1])) {
            if (currentSchemaData.name !== schemaMatch[1]) {
              // Found a new schema, save current and start new
              if (currentSchemaData.tables.length > 0 || currentSchemaData.views.length > 0 || currentSchemaData.enums.length > 0) {
                summary.schemas.push(currentSchemaData);
              }
              currentSchemaData = {
                name: schemaMatch[1],
                tables: [],
                views: [],
                enums: [],
              };
            }
          }

          // Extract table/view/enum names from nested structure
          if (currentSchemaData) {
            // Look for table names inside Tables section
            const tableMatch = line.match(/^\s+(\w+):\s*{/) && line.includes('      '); // More indented
            if (tableMatch) {
              const tableName = line.match(/^\s+(\w+):/)?.[1];
              if (tableName && !['Tables', 'Views', 'Enums', 'Row', 'Insert', 'Update'].includes(tableName)) {
                currentSchemaData.tables.push(tableName);
                summary.total_types++;
              }
            }

            // Look for view names inside Views section
            const viewMatch = line.match(/^\s+(\w+):\s*{/) && line.includes('      ') && lines[lines.indexOf(line) - 5]?.includes('Views:');
            if (viewMatch) {
              const viewName = line.match(/^\s+(\w+):/)?.[1];
              if (viewName && viewName !== 'Row') {
                currentSchemaData.views.push(viewName);
                summary.total_types++;
              }
            }

            // Look for enum names inside Enums section
            const enumMatch = line.match(/^\s+(\w+):\s*/) && line.includes('      ') && lines[lines.indexOf(line) - 2]?.includes('Enums:');
            if (enumMatch) {
              const enumName = line.match(/^\s+(\w+):/)?.[1];
              if (enumName) {
                currentSchemaData.enums.push(enumName);
                summary.total_types++;
              }
            }
          }
        }

        // Add the last schema
        if (currentSchemaData) {
          summary.schemas.push(currentSchemaData);
        }

        // Add counts if requested
        if (include_counts) {
          summary.schemas.forEach(schema => {
            schema.table_count = schema.tables?.length || 0;
            schema.view_count = schema.views?.length || 0;
            schema.enum_count = schema.enums?.length || 0;
            // Remove arrays to save space when showing counts
            delete schema.tables;
            delete schema.views;
            delete schema.enums;
          });
        }

        return limitResponseSize(
          summary,
          'TypeScript types summary - use generate_typescript_types with filtering for full types',
          { maxTokens: 3000 }
        );
      },
    }),
  };
}
