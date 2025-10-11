#!/bin/bash

# Test script to verify new tools are registered in the MCP server
# This simulates how the MCP client would interact with the server

echo "=== Testing MCP Server Tool Registration ===" >&2
echo "" >&2

# Set minimal required environment
export SUPABASE_ACCESS_TOKEN="sbp_test_token_for_listing_only"

# Send tools/list request
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/transports/stdio.js 2>&1 | head -200
