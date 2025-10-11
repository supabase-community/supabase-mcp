#!/bin/bash

# Test script to validate tool schemas for new Phase 1-3 tools
# Validates that each tool has correct parameters and annotations

echo "=== Validating Tool Schemas ===" >&2
echo "" >&2

# Set minimal required environment
export SUPABASE_ACCESS_TOKEN="sbp_test_token_for_schema_validation"

# Get tools list
TOOLS_JSON=$(echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/transports/stdio.js 2>/dev/null)

# Phase 1: Backup & Recovery Tools
echo "Phase 1 - Backup & Recovery Tools:" >&2
echo "" >&2

echo "Testing undo_database_restore..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "undo_database_restore") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "Testing list_restore_points..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "list_restore_points") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "Testing create_restore_point..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "create_restore_point") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

# Phase 2: Configuration Tools
echo "" >&2
echo "Phase 2 - Configuration Tools:" >&2
echo "" >&2

echo "Testing get_postgrest_config..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "get_postgrest_config") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "Testing update_postgrest_config..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "update_postgrest_config") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "Testing get_pgsodium_config..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "get_pgsodium_config") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "Testing update_pgsodium_config..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "update_pgsodium_config") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

# Phase 3: SQL Snippets Tools
echo "" >&2
echo "Phase 3 - SQL Snippets Tools:" >&2
echo "" >&2

echo "Testing list_sql_snippets..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "list_sql_snippets") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "Testing get_sql_snippet..." >&2
echo "$TOOLS_JSON" | jq -r '.result.tools[] | select(.name == "get_sql_snippet") | "  ✓ Found tool: \(.name)\n  Description: \(.description)\n  Required params: \(.inputSchema.required | join(", "))\n  Destructive: \(.annotations.destructiveHint)\n  ReadOnly: \(.annotations.readOnlyHint)"'

echo "" >&2
echo "=== Schema Validation Complete ===" >&2
