import { describe, expect, expectTypeOf, test } from 'vitest';
import { createToolSchemas, supabaseMcpToolSchemas } from './tool-schemas.js';

describe('createToolSchemas', () => {
  describe('no options (default)', () => {
    test('returns all tools', () => {
      const schemas = createToolSchemas();
      expect(Object.keys(schemas).sort()).toEqual(
        Object.keys(supabaseMcpToolSchemas).sort()
      );
    });

    test('schemas match original schemas', () => {
      const schemas = createToolSchemas();
      for (const [name, schema] of Object.entries(supabaseMcpToolSchemas)) {
        expect(schemas[name as keyof typeof schemas]).toBe(schema);
      }
    });

    test('type includes all tool names', () => {
      const schemas = createToolSchemas();
      expectTypeOf(schemas).toHaveProperty('execute_sql');
      expectTypeOf(schemas).toHaveProperty('search_docs');
      expectTypeOf(schemas).toHaveProperty('list_organizations');
      expectTypeOf(schemas).toHaveProperty('deploy_edge_function');
      expectTypeOf(schemas).toHaveProperty('list_storage_buckets');
    });
  });

  describe('feature filtering', () => {
    test('only includes tools for specified features', () => {
      const schemas = createToolSchemas({ features: ['database', 'docs'] });
      expect(Object.keys(schemas).sort()).toEqual([
        'apply_migration',
        'execute_sql',
        'list_extensions',
        'list_migrations',
        'list_tables',
        'search_docs',
      ]);
    });

    test('type narrows to only specified feature tools', () => {
      const schemas = createToolSchemas({ features: ['database', 'docs'] });

      // Should be present
      expectTypeOf(schemas).toHaveProperty('execute_sql');
      expectTypeOf(schemas).toHaveProperty('search_docs');

      // Should NOT be present
      expectTypeOf(schemas).not.toHaveProperty('list_organizations');
      expectTypeOf(schemas).not.toHaveProperty('deploy_edge_function');
    });

    test('single feature', () => {
      const schemas = createToolSchemas({ features: ['docs'] });
      expect(Object.keys(schemas)).toEqual(['search_docs']);

      // Type narrows to only search_docs
      expectTypeOf(schemas).toHaveProperty('search_docs');
      expectTypeOf(schemas).not.toHaveProperty('execute_sql');
    });
  });

  describe('PROJECT_SCOPED_OVERRIDES completeness', () => {
    test('all tools with project_id in inputSchema have it omitted in project-scoped mode', () => {
      const projectScopedSchemas = createToolSchemas({ projectScoped: true });

      for (const [name, { inputSchema }] of Object.entries(
        supabaseMcpToolSchemas
      )) {
        const shape = inputSchema._zod.def.shape;
        if (!('project_id' in shape)) continue;

        // Account tools are excluded entirely from project-scoped mode - skip them
        if (!(name in projectScopedSchemas)) continue;

        const projectScopedEntry =
          projectScopedSchemas[name as keyof typeof projectScopedSchemas];
        const projectScopedShape =
          projectScopedEntry.inputSchema._zod.def.shape;

        expect(
          projectScopedShape,
          `Tool "${name}" has project_id in inputSchema but it is not omitted in project-scoped mode — add it to PROJECT_SCOPED_OVERRIDES`
        ).not.toHaveProperty('project_id');
      }
    });
  });

  describe('projectScoped', () => {
    test('excludes account tools', () => {
      const schemas = createToolSchemas({ projectScoped: true });
      const keys = Object.keys(schemas);

      // Account tools should be absent
      expect(keys).not.toContain('list_organizations');
      expect(keys).not.toContain('get_organization');
      expect(keys).not.toContain('list_projects');
      expect(keys).not.toContain('get_project');
      expect(keys).not.toContain('get_cost');
      expect(keys).not.toContain('confirm_cost');
      expect(keys).not.toContain('create_project');
      expect(keys).not.toContain('pause_project');
      expect(keys).not.toContain('restore_project');
    });

    test('type excludes account tools', () => {
      const schemas = createToolSchemas({ projectScoped: true });
      expectTypeOf(schemas).not.toHaveProperty('list_organizations');
      expectTypeOf(schemas).not.toHaveProperty('create_project');
    });

    test('omits project_id from applicable input schemas', () => {
      const schemas = createToolSchemas({ projectScoped: true });

      // execute_sql should not have project_id
      const executeSqlInput = schemas.execute_sql.inputSchema;
      const shape = executeSqlInput._zod.def.shape;
      expect(shape).not.toHaveProperty('project_id');
      expect(shape).toHaveProperty('query');
    });

    test('type reflects project_id omission', () => {
      const schemas = createToolSchemas({ projectScoped: true });

      // The input schema type should NOT include project_id
      type ExecuteSqlInput = (typeof schemas)['execute_sql']['inputSchema'];
      expectTypeOf<ExecuteSqlInput>().not.toHaveProperty('project_id');
    });

    test('non-project-id tools retain original schemas', () => {
      const schemas = createToolSchemas({ projectScoped: true });

      // search_docs has no project_id - should use original schema
      expect(schemas.search_docs).toBe(supabaseMcpToolSchemas.search_docs);

      // delete_branch uses branch_id, not project_id - should use original schema
      expect(schemas.delete_branch).toBe(supabaseMcpToolSchemas.delete_branch);
    });
  });

  describe('readOnly', () => {
    test('excludes write-only tools', () => {
      const schemas = createToolSchemas({ readOnly: true });
      const keys = Object.keys(schemas);

      expect(keys).not.toContain('create_project');
      expect(keys).not.toContain('pause_project');
      expect(keys).not.toContain('restore_project');
      expect(keys).not.toContain('create_branch');
      expect(keys).not.toContain('delete_branch');
      expect(keys).not.toContain('merge_branch');
      expect(keys).not.toContain('reset_branch');
      expect(keys).not.toContain('rebase_branch');
      expect(keys).not.toContain('apply_migration');
      expect(keys).not.toContain('deploy_edge_function');
      expect(keys).not.toContain('update_storage_config');
    });

    test('keeps read-only tools', () => {
      const schemas = createToolSchemas({ readOnly: true });
      const keys = Object.keys(schemas);

      expect(keys).toContain('execute_sql');
      expect(keys).toContain('search_docs');
      expect(keys).toContain('list_tables');
      expect(keys).toContain('list_organizations');
    });

    test('type excludes write-only tools', () => {
      const schemas = createToolSchemas({ readOnly: true });
      expectTypeOf(schemas).not.toHaveProperty('create_project');
      expectTypeOf(schemas).not.toHaveProperty('deploy_edge_function');
      expectTypeOf(schemas).toHaveProperty('execute_sql');
      expectTypeOf(schemas).toHaveProperty('search_docs');
    });
  });

  describe('combined options', () => {
    test('projectScoped + readOnly', () => {
      const schemas = createToolSchemas({
        projectScoped: true,
        readOnly: true,
      });
      const keys = Object.keys(schemas);

      // Account tools excluded (projectScoped)
      expect(keys).not.toContain('list_organizations');

      // Write tools excluded (readOnly)
      expect(keys).not.toContain('apply_migration');
      expect(keys).not.toContain('deploy_edge_function');

      // Read tools with project_id omitted
      expect(keys).toContain('execute_sql');
      const executeSqlShape = schemas.execute_sql.inputSchema._zod.def.shape;
      expect(executeSqlShape).not.toHaveProperty('project_id');
    });

    test('features + projectScoped + readOnly', () => {
      const schemas = createToolSchemas({
        features: ['database', 'docs'],
        projectScoped: true,
        readOnly: true,
      });
      const keys = Object.keys(schemas).sort();

      // Only database read tools + docs
      expect(keys).toEqual([
        'execute_sql',
        'list_extensions',
        'list_migrations',
        'list_tables',
        'search_docs',
      ]);
    });

    test('type narrows correctly with all options', () => {
      const schemas = createToolSchemas({
        features: ['database', 'docs'],
        projectScoped: true,
        readOnly: true,
      });

      // Present
      expectTypeOf(schemas).toHaveProperty('execute_sql');
      expectTypeOf(schemas).toHaveProperty('search_docs');
      expectTypeOf(schemas).toHaveProperty('list_tables');

      // Absent (not in features)
      expectTypeOf(schemas).not.toHaveProperty('list_organizations');
      expectTypeOf(schemas).not.toHaveProperty('deploy_edge_function');

      // Absent (write tool filtered by readOnly)
      expectTypeOf(schemas).not.toHaveProperty('apply_migration');
    });
  });
});
