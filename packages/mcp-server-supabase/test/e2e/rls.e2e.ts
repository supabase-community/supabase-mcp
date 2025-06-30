/// <reference types="../extensions.d.ts" />

import { PgParser, unwrapNode, unwrapParseResult } from '@supabase/pg-parser';
import type {
  A_Const,
  AlterTableStmt,
  ColumnRef,
  CreatePolicyStmt,
  FuncCall,
  Node,
  RawStmt,
  RoleSpec,
  String,
} from '@supabase/pg-parser/17/types';
import {
  generateText,
  ToolCallPart,
  type ToolCallUnion,
  type ToolSet,
} from 'ai';
import { describe, expect, test } from 'vitest';
import { createOrganization, createProject, MockProject } from '../mocks.js';
import { getTestModel, setup } from './utils.js';

const parser = new PgParser();

async function mockAuthSchema(project: MockProject) {
  await project.db.sql`
    create role anon;
  `;
  await project.db.sql`
    create role authenticated;
  `;
  await project.db.sql`
    create schema auth;
  `;
  await project.db.sql`
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      username text not null,
      created_at timestamp default now()
    );
  `;
  await project.db.sql`
    insert into auth.users (id, username) values (
      '00000000-0000-0000-0000-000000000000',
      'mock_user'
    );
  `;
  await project.db.sql`
    create function auth.jwt()
    returns jsonb as $$
      select jsonb_build_object(
        'uuid', '00000000-0000-0000-0000-000000000000'::uuid,
        'aal', 'aal1'
      );
    $$ language sql;
  `;
  await project.db.sql`
    create function auth.uid()
    returns uuid as $$
      select (auth.jwt() ->> 'uuid')::uuid
    $$ language sql;
  `;
}

/**
 * Extract all SQL statements (migrations and directly executed SQL) from tool
 * calls
 */
function extractSqlFromToolCalls(
  toolCalls: ToolCallUnion<ToolSet>[]
): string[] {
  const sqlStatements: string[] = [];

  for (const call of toolCalls) {
    if (call.toolName === 'apply_migration' && 'args' in call) {
      sqlStatements.push(call.args.query as string);
    } else if (call.toolName === 'execute_sql' && 'args' in call) {
      sqlStatements.push(call.args.query as string);
    }
  }

  return sqlStatements;
}

async function parseSql(sql: string) {
  const parsed = await parser.parse(sql);
  const result = await unwrapParseResult(parsed);
  return result.stmts ?? [];
}

/**
 * Extract a list of created tables from a list of SQL statements
 */
function extractCreatedTables(stmts: RawStmt[]): string[] {
  return stmts
    .map((stmt): string | null => {
      if (!stmt.stmt) return null;

      const node = unwrapNode(stmt.stmt);
      if (node.type !== 'CreateStmt') return null;

      return node.node.relation?.relname ?? null;
    })
    .filter((result) => result != null);
}

/**
 * Checks if a statement enables RLS on a table
 */
function isRlsEnableStatement(stmt: AlterTableStmt): boolean {
  return (
    stmt.cmds?.some((cmd) => {
      const unwrappedCmd = unwrapNode(cmd);
      return (
        unwrappedCmd.type === 'AlterTableCmd' &&
        unwrappedCmd.node.subtype === 'AT_EnableRowSecurity'
      );
    }) ?? false
  );
}

/**
 * Extract a list of tables on which RLS was enabled from a list of SQL statements
 */
function extractRlsEnabledTables(stmts: RawStmt[]): string[] {
  return stmts
    .map((stmt): string | null => {
      if (!stmt.stmt) return null;

      const node = unwrapNode(stmt.stmt);
      if (node.type !== 'AlterTableStmt') return null;

      if (!isRlsEnableStatement(node.node)) return null;
      return node.node.relation?.relname ?? null;
    })
    .filter((result) => result != null);
}

/**
 * Extract all create policy statements from a list of SQL statements
 */
function extractCreatePolicyStmts(stmts: RawStmt[]): CreatePolicyStmt[] {
  return stmts
    .map((stmt) => {
      if (!stmt.stmt) return null;

      const node = unwrapNode(stmt.stmt);
      switch (node.type) {
        case 'CreatePolicyStmt':
          return node.node;
        default:
          return null;
      }
    })
    .filter((node) => node != null);
}

/**
 * Check whether a sub-statement is (auth.uid() = user.id)
 */
function isAuthUidEqUserId(node: Node | undefined): boolean {
  if (!node) return false;

  const unwrappedNode = unwrapNode(node);
  if (unwrappedNode.type !== 'A_Expr') return false;

  const expr = unwrappedNode.node;
  if (expr.kind !== 'AEXPR_OP') return false;
  if (unwrapString(expr?.name?.[0]).sval !== '=') return false;

  const lexpr = unwrapFuncCall(expr.lexpr).funcname;
  if (unwrapString(lexpr?.[0]).sval !== 'auth') return false;
  if (unwrapString(lexpr?.[1]).sval !== 'uid') return false;

  const rexpr = unwrapColumnRef(expr.rexpr).fields;
  if (unwrapString(rexpr?.[0]).sval !== 'user_id') return false;

  return true;
}

/**
 * Check whether a node contains the MFA condition: (auth.jwt() ->> 'aal')::text = 'aal2'
 */
function containsMfaCheck(node: Node | undefined): boolean {
  if (!node) return false;

  const unwrappedNode = unwrapNode(node);

  // Handle BoolExpr (AND/OR expressions)
  if (unwrappedNode.type === 'BoolExpr') {
    const boolExpr = unwrappedNode.node;
    return boolExpr.args?.some((arg) => containsMfaCheck(arg)) ?? false;
  }

  // Handle A_Expr (expressions like equality checks)
  if (unwrappedNode.type === 'A_Expr') {
    const expr = unwrappedNode.node;
    if (expr.kind !== 'AEXPR_OP') return false;

    // Check operator name exists and is '='
    if (!expr.name?.[0]) return false;
    if (unwrapString(expr.name[0]).sval !== '=') return false;

    try {
      // Check if left side is either (auth.jwt() ->> 'aal') or (auth.jwt() ->> 'aal')::text
      if (!expr.lexpr) return false;
      const lexpr = unwrapNode(expr.lexpr);

      let jwtExprNode: Node;

      // Handle optional typecast
      if (lexpr.type === 'TypeCast') {
        const typeCast = lexpr.node;
        if (!typeCast.arg) return false;
        jwtExprNode = typeCast.arg;
      } else {
        jwtExprNode = expr.lexpr;
      }

      const argNode = unwrapNode(jwtExprNode);
      if (argNode.type !== 'A_Expr') return false;
      const argExpr = argNode.node;

      if (argExpr.kind !== 'AEXPR_OP') return false;
      if (!argExpr.name?.[0]) return false;
      if (unwrapString(argExpr.name[0]).sval !== '->>') return false;

      // Check auth.jwt() function call
      if (!argExpr.lexpr) return false;
      const jwtFunc = unwrapFuncCall(argExpr.lexpr);
      const jwtFuncName = jwtFunc.funcname;
      if (!jwtFuncName?.[0] || !jwtFuncName?.[1]) return false;
      if (unwrapString(jwtFuncName[0]).sval !== 'auth') return false;
      if (unwrapString(jwtFuncName[1]).sval !== 'jwt') return false;

      // Check 'aal' string constant
      if (!argExpr.rexpr) return false;
      const aalConst = unwrapAbstractConstant(argExpr.rexpr);
      if (aalConst.sval?.sval !== 'aal') return false;

      // Check right side is 'aal2'
      if (!expr.rexpr) return false;
      const rexpr = unwrapAbstractConstant(expr.rexpr);
      if (rexpr.sval?.sval !== 'aal2') return false;

      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Unwraps a Postgres AbstractConstant node. If node is not AbstractConstant,
 * throws an error.
 */
function unwrapAbstractConstant(node: Node | undefined): A_Const {
  if (!node) {
    throw Error('Expected a node, got undefined');
  }

  const unwrappedNode = unwrapNode(node);
  switch (unwrappedNode.type) {
    case 'A_Const':
      return unwrappedNode.node;
    default:
      throw Error(
        `Expected an A_Const (Abstract Constant) node, got ${unwrappedNode.type}`
      );
  }
}

/**
 * Unwraps a Postgres ColumnRef node. If node is not ColumnRef, throws an error.
 */
function unwrapColumnRef(node: Node | undefined): ColumnRef {
  if (!node) {
    throw Error('Expected a node, got undefined');
  }

  const unwrappedNode = unwrapNode(node);
  switch (unwrappedNode.type) {
    case 'ColumnRef':
      return unwrappedNode.node;
    default:
      throw Error(`Expected a ColumnRef node, got ${unwrappedNode.type}`);
  }
}

/**
 * Unwraps a Postgres FuncCall node. If node is not FuncCall, throws an error.
 */
function unwrapFuncCall(node: Node | undefined): FuncCall {
  if (!node) {
    throw Error('Expected a node, got undefined');
  }

  const unwrappedNode = unwrapNode(node);
  switch (unwrappedNode.type) {
    case 'FuncCall':
      return unwrappedNode.node;
    default:
      throw Error(`Expected a FuncCall node, got ${unwrappedNode.type}`);
  }
}

/**
 * Unwraps a Postgres RoleSpec node. If node is not RoleSpec, throws an error.
 */
function unwrapRoleSpec(node: Node | undefined): RoleSpec {
  if (!node) {
    throw Error('Expected a node, got undefined');
  }

  const unwrappedNode = unwrapNode(node);
  switch (unwrappedNode.type) {
    case 'RoleSpec':
      return unwrappedNode.node;
    default:
      throw Error(`Expected a RoleSpec node, got ${unwrappedNode.type}`);
  }
}

/**
 * Unwraps a Postgres String node. If node is not String, throws an error.
 */
function unwrapString(node: Node | undefined): String {
  if (!node) {
    throw Error('Expected a node, got undefined');
  }

  const unwrappedNode = unwrapNode(node);
  switch (unwrappedNode.type) {
    case 'String':
      return unwrappedNode.node;
    default:
      throw Error(`Expected a String node, got ${unwrappedNode.type}`);
  }
}

/**
 * Format tool calls as a string to be passed to the evaluator LLM
 */
function formatToolCalls(toolCalls: ToolCallPart[]): string {
  return toolCalls
    .map(
      (toolCall) =>
        `Tool call: ${toolCall.toolName}(${JSON.stringify(toolCall.args, null, 2)})`
    )
    .join('\n');
}

describe('RLS policies [e2e]', () => {
  test('Adds RLS to newly created tables without prompting', async () => {
    const { client } = await setup();
    const model = getTestModel();

    const org = await createOrganization({
      name: 'Test Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });
    const project = await createProject({
      name: 'todo-list-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    const { text } = await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant helping a user to build an app. The current working directory is /home/todo-list-app.',
        },
        {
          role: 'user',
          content: 'Create a database schema for a todo-list app.',
        },
      ],
      maxSteps: 3,
      async onStepFinish({ toolCalls: tools }) {
        toolCalls.push(...tools);
      },
    });

    const sqlStatements = extractSqlFromToolCalls(toolCalls);
    const allStatements = (
      await Promise.all(sqlStatements.map((sql) => parseSql(sql)))
    ).flat();

    const createdTables = extractCreatedTables(allStatements);
    // The given task is a realistic setup requiring at least 2 database tables
    // to complete. We want 2 or more tables to ensure RLS is enabled on _every_
    // created table.
    expect(createdTables.length).toBeGreaterThan(1);
    const rlsEnabledTables = extractRlsEnabledTables(allStatements);

    const numTablesCreatedWithoutRls = createdTables.reduce(
      (sum, table) => (rlsEnabledTables.includes(table) ? sum : sum + 1),
      0
    );
    expect(numTablesCreatedWithoutRls).toBe(0);
  });

  test('Enables RLS on existing tables and adds reasonable policies', async () => {
    const { client } = await setup();
    const model = getTestModel();

    const org = await createOrganization({
      name: 'Test Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });
    const project = await createProject({
      name: 'blog-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    // Create a table without RLS (simulating existing database)
    await mockAuthSchema(project);
    await project.db.sql`
      create table posts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references auth.users(id),
        title text not null,
        content text,
        created_at timestamp default now()
      );
    `;

    const text: string[] = [];
    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant helping a user to build an app. The current directory is /home/workspace/blog-app.',
        },
        {
          role: 'user',
          content:
            'Examine the database for the blog-app project and help me secure my data with Supabase.',
        },
      ],
      maxSteps: 6,
      async onStepFinish({ text: newText, toolCalls: tools }) {
        text.push(`${newText}\n${formatToolCalls(tools)}`);
        toolCalls.push(...tools);
      },
    });

    const sqlStatements = extractSqlFromToolCalls(toolCalls);
    const allStatements = (
      await Promise.all(sqlStatements.map((sql) => parseSql(sql)))
    ).flat();

    // Verify RLS was enabled on the posts table
    const rlsEnabledTables = extractRlsEnabledTables(allStatements);
    expect(rlsEnabledTables).toContain('posts');

    // Verify reasonable policies were created
    const policyStmts = extractCreatePolicyStmts(allStatements);

    // Select policy with USING (true)
    const selectPolicy = policyStmts.find(
      (policy) => policy.cmd_name === 'select'
    );
    expect(selectPolicy?.with_check).toBe(undefined);
    expect(unwrapAbstractConstant(selectPolicy?.qual).boolval?.boolval).toBe(
      true
    );

    // Insert policy with WITH CHECK (auth.uid() = user_id)
    const insertPolicy = policyStmts.find(
      (policy) => policy.cmd_name === 'insert'
    );
    expect(insertPolicy?.qual).toBeUndefined();
    expect(isAuthUidEqUserId(insertPolicy?.with_check)).toBe(true);

    // Update policy with USING (auth.uid() = user_id)
    const updatePolicy = policyStmts.find(
      (policy) => policy.cmd_name == 'update'
    );
    expect(isAuthUidEqUserId(updatePolicy?.qual)).toBe(true);
    // Update policies should include explicit WITH CHECK but this is currently
    // inconsistent
    // expect(isAuthUidEqUserId(updatePolicy?.with_check)).toBe(true);

    // Delete policy with USING (auth.uid() = user_id)
    const deletePolicy = policyStmts.find(
      (policy) => policy.cmd_name == 'delete'
    );
    expect(deletePolicy?.with_check).toBe(undefined);
    expect(isAuthUidEqUserId(deletePolicy?.qual)).toBe(true);

    // Verify LLM output to downstream makes sense
    await expect(text.join('\n\n')).toMatchCriteria(
      'Identifies posts table as missing RLS. Enables RLS on the table and creates reasonable policies: (1) Allow all users to read all posts. (2) Allow users to create their own posts. (3) Allow users to update their own posts. (4) Allow users to delete their own posts. For actions that are scoped to the current user, uses auth.uid() to check for authorization.'
    );
  });

  // Complicated workflow that requires LLM to check and understand
  // documentation about MFA
  test('Enables MFA check when requested', async () => {
    const { client } = await setup();
    const model = getTestModel();

    const org = await createOrganization({
      name: 'Test Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });
    const project = await createProject({
      name: 'blog-app',
      region: 'us-east-1',
      organization_id: org.id,
    });

    await mockAuthSchema(project);
    await project.db.sql`
      create table posts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references auth.users(id),
        title text not null,
        content text,
        created_at timestamp default now()
      );
    `;
    await project.db.sql`
      alter table posts enable row level security;
    `;
    await project.db.sql`
      create policy "user can create own posts"
      on public.posts
      for insert
      to authenticated
      with check((select auth.uid()) = user_id);
    `;

    const text: string[] = [];
    const toolCalls: ToolCallUnion<ToolSet>[] = [];
    const tools = await client.tools();

    await generateText({
      model,
      tools,
      messages: [
        {
          role: 'system',
          content:
            'You are a coding assistant helping a user to build an app. The current directory is /home/workspace/blog-app.',
        },
        {
          role: 'user',
          content:
            'Require that users have two-factor authentication and be signed in with their second factor to create a post.',
        },
      ],
      maxSteps: 12,
      async onStepFinish({ text: newText, toolCalls: tools }) {
        text.push(`${newText}\n${formatToolCalls(tools)}`);
        toolCalls.push(...tools);
      },
    });

    const sqlStatements = extractSqlFromToolCalls(toolCalls);
    const allStatements = (
      await Promise.all(sqlStatements.map((sql) => parseSql(sql)))
    ).flat();

    const policyStmts = extractCreatePolicyStmts(allStatements);
    const insertPolicy = policyStmts.find((pol) => pol.cmd_name === 'insert');

    // Policy should have role authenticated
    const roles = insertPolicy?.roles ?? [];
    expect(roles).toHaveLength(1);
    expect(unwrapRoleSpec(roles[0]!).rolename).toBe('authenticated');

    // Policy should contain MFA check
    expect(containsMfaCheck(insertPolicy?.with_check)).toBe(true);

    // Also check using evaluator LLM since there are multiple ways the LLM
    //  could choose to combine new and existing policies
    expect(text).toMatchCriteria(
      'Creates a RLS policy that requires users to be signed in with two-factor authentication to create a post. Preserves existing RLS policies, so that users must be BOTH signed in and creating a post on their own behalf. If two separate policies are used, the MFA policy MUST be created as a restrictive policy. If a single policy is used, the policy criteria MUST be combined with AND.'
    );
  }, 120_000);
});
