#!/bin/bash

# Supabase MCP Claude CLI Authentication Wrapper Script
# This script provides a reliable authentication wrapper for Claude CLI integration
#
# Usage: This script should be configured as the MCP server command in Claude CLI
# instead of calling the MCP server directly.
#
# Configuration:
# 1. Set your Personal Access Token below (replace YOUR_TOKEN_HERE)
# 2. Set your Project Reference below (replace YOUR_PROJECT_REF_HERE)
# 3. Make this script executable: chmod +x claude-cli-wrapper.sh
# 4. Add to Claude CLI: claude mcp add supabase /path/to/claude-cli-wrapper.sh

# ==============================================================================
# CONFIGURATION - Update these values for your project
# ==============================================================================

# Your Supabase Personal Access Token (starts with sbp_)
# Get this from: https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN="YOUR_TOKEN_HERE"

# Your Supabase Project Reference (found in project settings)
# Get this from: https://supabase.com/dashboard/project/_/settings/general
PROJECT_REF="YOUR_PROJECT_REF_HERE"

# ==============================================================================
# SCRIPT LOGIC - Do not modify below this line unless you know what you're doing
# ==============================================================================

# Validate configuration
if [ "$SUPABASE_ACCESS_TOKEN" = "YOUR_TOKEN_HERE" ]; then
    echo "Error: Please set your SUPABASE_ACCESS_TOKEN in this script" >&2
    echo "Get your token from: https://supabase.com/dashboard/account/tokens" >&2
    exit 1
fi

if [ "$PROJECT_REF" = "YOUR_PROJECT_REF_HERE" ]; then
    echo "Error: Please set your PROJECT_REF in this script" >&2
    echo "Get your project ref from: https://supabase.com/dashboard/project/_/settings/general" >&2
    exit 1
fi

# Validate token format
if [[ ! "$SUPABASE_ACCESS_TOKEN" =~ ^sbp_ ]]; then
    echo "Error: SUPABASE_ACCESS_TOKEN must start with 'sbp_'" >&2
    echo "Please ensure you're using a Personal Access Token, not an API key" >&2
    exit 1
fi

# Determine the path to the MCP server
# Try published package first, then local build
if command -v npx >/dev/null 2>&1; then
    # Use published package
    MCP_COMMAND="npx @supabase/mcp-server-supabase"
else
    echo "Error: npx not found. Please install Node.js" >&2
    exit 1
fi

# Execute the MCP server with proper authentication
exec $MCP_COMMAND \
    --access-token="$SUPABASE_ACCESS_TOKEN" \
    --project-ref="$PROJECT_REF" \
    "$@"