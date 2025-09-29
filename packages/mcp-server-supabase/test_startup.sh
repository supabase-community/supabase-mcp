#!/bin/bash

echo "=== Testing MCP Server Project Detection ==="

# Test 1: Next.js App
echo -e "\n--- Test 1: Next.js App Directory ---"
cd test_projects/nextjs_app
echo "Current directory: $(pwd)"
echo "Files present: $(ls -la | grep env)"

# Start the server and capture output for 2 seconds
export SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase/access-token)
echo '{}' | timeout 2s node ../../dist/transports/stdio.js 2>&1 | head -10 || true

cd ../..

# Test 2: Supabase CLI Project
echo -e "\n--- Test 2: Supabase CLI Project ---"
cd test_projects/supabase_cli_project
echo "Current directory: $(pwd)"
echo "Files present: $(ls -la .supabase/)"

# Start the server and capture output for 2 seconds
echo '{}' | timeout 2s node ../../dist/transports/stdio.js 2>&1 | head -10 || true

cd ../..

echo -e "\n=== Test Complete ==="