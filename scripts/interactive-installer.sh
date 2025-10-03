#!/bin/bash

# Supabase MCP Interactive Installer
#
# This script provides an interactive installation experience for the Supabase MCP server,
# with automatic detection of existing configuration, guided setup for missing values,
# and proper Claude CLI integration.
#
# Features:
# - Auto-detects existing Supabase CLI authentication
# - Scans current directory for project configuration
# - Guides user through missing configuration setup
# - Generates optimized wrapper scripts for Claude CLI
# - Validates configuration and tests connectivity
# - Handles upgrades and conflicts gracefully

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_PACKAGE="@supabase/mcp-server-supabase"
CLAUDE_CONFIG_DIR="$HOME/.claude"
SUPABASE_CONFIG_DIR="$HOME/.supabase"
ACCESS_TOKEN_FILE="$SUPABASE_CONFIG_DIR/access-token"

# Global variables for detected configuration
DETECTED_TOKEN=""
DETECTED_PROJECT_REF=""
DETECTED_PROJECT_URL=""
DETECTED_ANON_KEY=""
DETECTED_SERVICE_KEY=""
PROJECT_CONTEXT_SOURCE=""
EXISTING_CLAUDE_CONFIG=""

#######################################
# Print functions
#######################################

print_header() {
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    Supabase MCP Interactive Installer                ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo
}

print_section() {
    echo -e "${CYAN}▶ $1${NC}"
    echo
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_step() {
    echo -e "${PURPLE}→ $1${NC}"
}

#######################################
# Detection functions
#######################################

detect_supabase_cli_token() {
    print_step "Checking for existing Supabase CLI authentication..."

    if [[ -f "$ACCESS_TOKEN_FILE" ]]; then
        DETECTED_TOKEN=$(cat "$ACCESS_TOKEN_FILE" | tr -d '\n\r')
        if [[ -n "$DETECTED_TOKEN" && "$DETECTED_TOKEN" =~ ^sbp_ ]]; then
            print_success "Found valid access token in ~/.supabase/access-token"
            return 0
        else
            print_warning "Found access token file but token appears invalid"
        fi
    fi

    # Check environment variable
    if [[ -n "$SUPABASE_ACCESS_TOKEN" && "$SUPABASE_ACCESS_TOKEN" =~ ^sbp_ ]]; then
        DETECTED_TOKEN="$SUPABASE_ACCESS_TOKEN"
        print_success "Found valid access token in environment variable"
        return 0
    fi

    print_info "No valid Supabase access token found"
    return 1
}

detect_project_context() {
    print_step "Scanning current directory for Supabase project configuration..."

    local current_dir="$(pwd)"
    local found_config=false

    # Check .env.local first (highest priority)
    if [[ -f ".env.local" ]]; then
        PROJECT_CONTEXT_SOURCE=".env.local"
        source_env_file ".env.local"
        found_config=true
    fi

    # Check .env
    if [[ -f ".env" ]]; then
        if [[ "$found_config" != true ]]; then
            PROJECT_CONTEXT_SOURCE=".env"
        fi
        source_env_file ".env"
        found_config=true
    fi

    # Check .supabase/config.toml
    if [[ -f ".supabase/config.toml" ]]; then
        if [[ "$found_config" != true ]]; then
            PROJECT_CONTEXT_SOURCE=".supabase/config.toml"
        fi
        parse_supabase_config ".supabase/config.toml"
        found_config=true
    fi

    # Check .supabase/.env
    if [[ -f ".supabase/.env" ]]; then
        if [[ "$found_config" != true ]]; then
            PROJECT_CONTEXT_SOURCE=".supabase/.env"
        fi
        source_env_file ".supabase/.env"
        found_config=true
    fi

    if [[ "$found_config" == true ]]; then
        print_success "Found project configuration in $PROJECT_CONTEXT_SOURCE"

        if [[ -n "$DETECTED_PROJECT_URL" ]]; then
            DETECTED_PROJECT_REF=$(extract_project_ref_from_url "$DETECTED_PROJECT_URL")
            if [[ -n "$DETECTED_PROJECT_REF" ]]; then
                print_success "Extracted project reference: $DETECTED_PROJECT_REF"
            fi
        fi

        # Show detected values
        if [[ -n "$DETECTED_PROJECT_URL" ]]; then
            echo "  Project URL: ${DETECTED_PROJECT_URL:0:30}..."
        fi
        if [[ -n "$DETECTED_ANON_KEY" ]]; then
            echo "  Anon Key: ${DETECTED_ANON_KEY:0:20}..."
        fi
        if [[ -n "$DETECTED_SERVICE_KEY" ]]; then
            echo "  Service Key: ${DETECTED_SERVICE_KEY:0:20}..."
        fi
    else
        print_info "No project configuration found in current directory"
    fi

    echo
}

source_env_file() {
    local env_file="$1"

    while IFS= read -r line; do
        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue

        # Parse key=value pairs
        if [[ "$line" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"

            # Remove quotes if present
            value=$(echo "$value" | sed 's/^["'\'']\|["'\'']$//g')

            case "$key" in
                SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL|VITE_SUPABASE_URL|REACT_APP_SUPABASE_URL)
                    DETECTED_PROJECT_URL="$value"
                    ;;
                SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|VITE_SUPABASE_ANON_KEY|REACT_APP_SUPABASE_ANON_KEY)
                    DETECTED_ANON_KEY="$value"
                    ;;
                SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY|SUPABASE_SECRET_KEY)
                    DETECTED_SERVICE_KEY="$value"
                    ;;
            esac
        fi
    done < "$env_file"
}

parse_supabase_config() {
    local config_file="$1"
    local in_api_section=false

    while IFS= read -r line; do
        line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

        # Check for [api] section
        if [[ "$line" == "[api]" ]]; then
            in_api_section=true
            continue
        fi

        # Check for other sections
        if [[ "$line" =~ ^\[.*\]$ && "$line" != "[api]" ]]; then
            in_api_section=false
            continue
        fi

        # Parse key-value pairs in [api] section
        if [[ "$in_api_section" == true && "$line" =~ ^([a-z_]+)[[:space:]]*=[[:space:]]*\"([^\"]+)\"$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"

            case "$key" in
                url)
                    DETECTED_PROJECT_URL="$value"
                    ;;
                anon_key)
                    DETECTED_ANON_KEY="$value"
                    ;;
                service_role_key)
                    DETECTED_SERVICE_KEY="$value"
                    ;;
            esac
        fi
    done < "$config_file"
}

extract_project_ref_from_url() {
    local url="$1"

    # Extract project ID from patterns like https://xxxxxxxxxxxx.supabase.co
    if [[ "$url" =~ https://([a-z0-9]+)\.supabase\.(co|in|io) ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

detect_existing_claude_config() {
    print_step "Checking existing Claude CLI configuration..."

    if [[ -f "$CLAUDE_CONFIG_DIR/claude_cli_config.json" ]]; then
        # Check if supabase MCP is already configured
        if grep -q '"supabase"' "$CLAUDE_CONFIG_DIR/claude_cli_config.json" 2>/dev/null; then
            EXISTING_CLAUDE_CONFIG="found"
            print_warning "Found existing Supabase MCP configuration in Claude CLI"

            # Show current configuration
            echo "Current configuration:"
            jq -r '.mcpServers.supabase' "$CLAUDE_CONFIG_DIR/claude_cli_config.json" 2>/dev/null | head -10
        else
            print_info "Claude CLI found but no existing Supabase MCP configuration"
        fi
    else
        print_info "No Claude CLI configuration found"
    fi

    echo
}

#######################################
# Interactive prompts
#######################################

prompt_for_access_token() {
    if [[ -n "$DETECTED_TOKEN" ]]; then
        echo -e "${GREEN}✓ Using detected access token: ${DETECTED_TOKEN:0:10}...${NC}"
        return 0
    fi

    print_section "🔑 Supabase Access Token Required"
    echo "A personal access token is required to authenticate with Supabase."
    echo
    echo "To get your token:"
    echo "1. Visit: https://supabase.com/dashboard/account/tokens"
    echo "2. Click 'Generate new token'"
    echo "3. Give it a name like 'Claude MCP Server'"
    echo "4. Copy the token (starts with 'sbp_')"
    echo

    while true; do
        read -p "Enter your Supabase access token: " -s token
        echo

        if [[ -z "$token" ]]; then
            print_error "Token cannot be empty"
            continue
        fi

        if [[ ! "$token" =~ ^sbp_ ]]; then
            print_error "Invalid token format. Token should start with 'sbp_'"
            echo "Make sure you're using a Personal Access Token, not an API key."
            continue
        fi

        DETECTED_TOKEN="$token"
        print_success "Valid token format detected"
        break
    done

    echo
}

prompt_for_project_ref() {
    if [[ -n "$DETECTED_PROJECT_REF" ]]; then
        echo -e "${GREEN}✓ Using detected project reference: $DETECTED_PROJECT_REF${NC}"
        return 0
    fi

    print_section "🎯 Project Configuration"
    echo "You can either:"
    echo "1. Scope the MCP to a specific project (recommended)"
    echo "2. Allow access to all projects in your account"
    echo

    read -p "Do you want to scope to a specific project? (Y/n): " scope_choice
    scope_choice=${scope_choice:-Y}

    if [[ "$scope_choice" =~ ^[Yy] ]]; then
        echo
        echo "To find your project reference:"
        echo "1. Visit: https://supabase.com/dashboard/project/_/settings/general"
        echo "2. Look for 'Reference ID' in the General settings"
        echo "3. It should be a string like 'abcdefghijklmnop'"
        echo

        while true; do
            read -p "Enter your project reference (or press Enter to skip): " project_ref

            if [[ -z "$project_ref" ]]; then
                print_info "Skipping project scoping - MCP will have access to all projects"
                break
            fi

            if [[ ! "$project_ref" =~ ^[a-z0-9]{16,20}$ ]]; then
                print_error "Invalid project reference format"
                echo "Project references are typically 16-20 lowercase alphanumeric characters"
                continue
            fi

            DETECTED_PROJECT_REF="$project_ref"
            print_success "Project reference set"
            break
        done
    fi

    echo
}

prompt_for_mode_selection() {
    print_section "🔒 Security Mode Selection"
    echo "Choose the security mode for your MCP server:"
    echo
    echo "1. Read-only mode (recommended)"
    echo "   - Safe for production use"
    echo "   - Prevents accidental data modifications"
    echo "   - Allows viewing data and schema"
    echo
    echo "2. Full access mode"
    echo "   - Allows database modifications"
    echo "   - Can create/update/delete data"
    echo "   - Use with caution"
    echo

    while true; do
        read -p "Select mode (1 for read-only, 2 for full access): " mode_choice

        case "$mode_choice" in
            1)
                READ_ONLY_MODE=true
                print_success "Read-only mode selected"
                break
                ;;
            2)
                READ_ONLY_MODE=false
                print_warning "Full access mode selected - use with caution"
                break
                ;;
            *)
                print_error "Please enter 1 or 2"
                ;;
        esac
    done

    echo
}

prompt_for_feature_groups() {
    print_section "🛠 Feature Groups Selection"
    echo "Choose which tool groups to enable:"
    echo
    echo "Available groups:"
    echo "  account    - Project and organization management"
    echo "  database   - SQL execution and migrations"
    echo "  debugging  - Logs and performance monitoring"
    echo "  development- API keys and TypeScript generation"
    echo "  docs       - Documentation search"
    echo "  functions  - Edge Functions management"
    echo "  branching  - Development branches (requires paid plan)"
    echo "  storage    - Storage buckets and configuration"
    echo "  runtime    - Mode management and project switching"
    echo
    echo "Default: account,database,debugging,development,docs,functions,branching"
    echo

    read -p "Enter feature groups (comma-separated) or press Enter for default: " features

    if [[ -z "$features" ]]; then
        FEATURE_GROUPS="account,database,debugging,development,docs,functions,branching"
        print_success "Using default feature groups"
    else
        FEATURE_GROUPS="$features"
        print_success "Custom feature groups: $FEATURE_GROUPS"
    fi

    echo
}

#######################################
# Configuration functions
#######################################

save_access_token() {
    if [[ -n "$DETECTED_TOKEN" ]]; then
        print_step "Saving access token to ~/.supabase/access-token..."

        # Create directory if it doesn't exist
        mkdir -p "$SUPABASE_CONFIG_DIR"

        # Write token to file
        echo "$DETECTED_TOKEN" > "$ACCESS_TOKEN_FILE"

        # Set secure permissions
        chmod 600 "$ACCESS_TOKEN_FILE"

        print_success "Access token saved and secured"
    fi
}

generate_wrapper_script() {
    print_step "Generating Claude CLI wrapper script..."

    local wrapper_path="$CLAUDE_CONFIG_DIR/supabase-mcp-wrapper.sh"

    # Create Claude config directory if it doesn't exist
    mkdir -p "$CLAUDE_CONFIG_DIR"

    cat > "$wrapper_path" << 'EOF'
#!/bin/bash

# Supabase MCP Claude CLI Wrapper (Auto-generated)
# This script provides reliable authentication for Claude CLI integration

# Configuration
export SUPABASE_ACCESS_TOKEN="PLACEHOLDER_TOKEN"
PROJECT_REF="PLACEHOLDER_PROJECT_REF"
READ_ONLY_MODE="PLACEHOLDER_READ_ONLY"
FEATURE_GROUPS="PLACEHOLDER_FEATURES"

# Validate configuration
if [ "$SUPABASE_ACCESS_TOKEN" = "PLACEHOLDER_TOKEN" ]; then
    echo "Error: Access token not configured in wrapper script" >&2
    exit 1
fi

if [[ ! "$SUPABASE_ACCESS_TOKEN" =~ ^sbp_ ]]; then
    echo "Error: Invalid access token format" >&2
    exit 1
fi

# Build command arguments
args=()

# Add access token
args+=("--access-token=$SUPABASE_ACCESS_TOKEN")

# Add project reference if specified
if [[ -n "$PROJECT_REF" && "$PROJECT_REF" != "PLACEHOLDER_PROJECT_REF" ]]; then
    args+=("--project-ref=$PROJECT_REF")
fi

# Add read-only mode if enabled
if [[ "$READ_ONLY_MODE" == "true" ]]; then
    args+=("--read-only")
fi

# Add feature groups if specified
if [[ -n "$FEATURE_GROUPS" && "$FEATURE_GROUPS" != "PLACEHOLDER_FEATURES" ]]; then
    args+=("--features=$FEATURE_GROUPS")
fi

# Execute the MCP server
exec npx "@supabase/mcp-server-supabase@latest" "${args[@]}" "$@"
EOF

    # Replace placeholders
    sed -i.bak \
        -e "s/PLACEHOLDER_TOKEN/$DETECTED_TOKEN/g" \
        -e "s/PLACEHOLDER_PROJECT_REF/$DETECTED_PROJECT_REF/g" \
        -e "s/PLACEHOLDER_READ_ONLY/$READ_ONLY_MODE/g" \
        -e "s/PLACEHOLDER_FEATURES/$FEATURE_GROUPS/g" \
        "$wrapper_path"

    # Remove backup file
    rm -f "$wrapper_path.bak"

    # Make executable
    chmod +x "$wrapper_path"

    print_success "Wrapper script generated: $wrapper_path"
    echo
}

#######################################
# Validation and testing
#######################################

validate_token() {
    if [[ -z "$DETECTED_TOKEN" ]]; then
        return 1
    fi

    print_step "Validating access token..."

    # Test token by making a simple API call
    local response
    response=$(curl -s -w "%{http_code}" \
        -H "Authorization: Bearer $DETECTED_TOKEN" \
        -H "Content-Type: application/json" \
        "https://api.supabase.com/v1/projects" \
        -o /tmp/supabase_test_response.json)

    local http_code="${response: -3}"

    if [[ "$http_code" == "200" ]]; then
        print_success "Access token is valid"

        # Show available projects if any
        local project_count
        project_count=$(jq length /tmp/supabase_test_response.json 2>/dev/null || echo "0")
        print_info "Found $project_count projects in your account"

        return 0
    else
        print_error "Access token validation failed (HTTP $http_code)"

        case "$http_code" in
            401)
                echo "  The token is invalid or expired"
                ;;
            403)
                echo "  The token doesn't have sufficient permissions"
                ;;
            *)
                echo "  Unexpected error occurred"
                ;;
        esac

        return 1
    fi
}

test_mcp_server() {
    print_step "Testing MCP server configuration..."

    local wrapper_path="$CLAUDE_CONFIG_DIR/supabase-mcp-wrapper.sh"

    if [[ ! -f "$wrapper_path" ]]; then
        print_error "Wrapper script not found"
        return 1
    fi

    # Test basic MCP server startup
    local test_response
    test_response=$(timeout 10s bash -c "echo '{\"jsonrpc\": \"2.0\", \"method\": \"tools/list\", \"id\": 1}' | $wrapper_path" 2>&1)

    if [[ $? -eq 0 && "$test_response" =~ "result" ]]; then
        print_success "MCP server test successful"

        # Count available tools
        local tool_count
        tool_count=$(echo "$test_response" | jq '.result.tools | length' 2>/dev/null || echo "unknown")
        print_info "MCP server has $tool_count tools available"

        return 0
    else
        print_error "MCP server test failed"
        echo "Error output:"
        echo "$test_response" | head -5
        return 1
    fi
}

#######################################
# Claude CLI integration
#######################################

remove_existing_claude_config() {
    if [[ "$EXISTING_CLAUDE_CONFIG" == "found" ]]; then
        print_step "Removing existing Supabase MCP configuration from Claude CLI..."

        # Use claude CLI to remove if available
        if command -v claude >/dev/null 2>&1; then
            claude mcp remove supabase 2>/dev/null || true
            print_success "Existing configuration removed"
        else
            print_warning "Claude CLI not found, manual cleanup may be needed"
        fi
    fi
}

add_to_claude_cli() {
    print_step "Adding Supabase MCP to Claude CLI..."

    local wrapper_path="$CLAUDE_CONFIG_DIR/supabase-mcp-wrapper.sh"

    if ! command -v claude >/dev/null 2>&1; then
        print_error "Claude CLI not found"
        echo "Please install Claude CLI first: https://claude.ai/cli"
        return 1
    fi

    # Add the MCP server
    if claude mcp add supabase "$wrapper_path"; then
        print_success "Supabase MCP added to Claude CLI"
        return 0
    else
        print_error "Failed to add MCP to Claude CLI"
        return 1
    fi
}

verify_claude_integration() {
    print_step "Verifying Claude CLI integration..."

    if ! command -v claude >/dev/null 2>&1; then
        print_warning "Claude CLI not available for verification"
        return 1
    fi

    # List MCP servers to verify
    local mcp_list
    mcp_list=$(claude mcp list 2>&1)

    if echo "$mcp_list" | grep -q "supabase.*Connected"; then
        print_success "Supabase MCP is connected and working"
        return 0
    elif echo "$mcp_list" | grep -q "supabase"; then
        print_warning "Supabase MCP is configured but may have connection issues"
        echo "Try running: claude mcp list"
        return 1
    else
        print_error "Supabase MCP not found in Claude CLI configuration"
        return 1
    fi
}

#######################################
# Main installation flow
#######################################

show_summary() {
    print_section "📋 Installation Summary"

    echo "Configuration:"
    echo "  Access Token: ${DETECTED_TOKEN:0:10}... ($([ -n "$DETECTED_TOKEN" ] && echo "configured" || echo "missing"))"
    echo "  Project Ref: ${DETECTED_PROJECT_REF:-"all projects"}"
    echo "  Security Mode: $([ "$READ_ONLY_MODE" == "true" ] && echo "read-only" || echo "full access")"
    echo "  Feature Groups: $FEATURE_GROUPS"
    echo "  Project Context: ${PROJECT_CONTEXT_SOURCE:-"none detected"}"
    echo

    echo "Files created/updated:"
    echo "  ~/.supabase/access-token (secure token storage)"
    echo "  ~/.claude/supabase-mcp-wrapper.sh (Claude CLI wrapper)"
    echo

    echo "Claude CLI:"
    echo "  Status: $(claude mcp list 2>/dev/null | grep -q "supabase.*Connected" && echo "connected" || echo "check manually")"
    echo

    print_info "To use the MCP server in Claude CLI, run: /mcp"
    echo
}

cleanup() {
    # Clean up temporary files
    rm -f /tmp/supabase_test_response.json
}

main() {
    trap cleanup EXIT

    print_header

    print_section "🔍 Detecting Current Configuration"
    detect_supabase_cli_token
    detect_project_context
    detect_existing_claude_config

    print_section "⚙️ Interactive Configuration"
    prompt_for_access_token
    prompt_for_project_ref
    prompt_for_mode_selection
    prompt_for_feature_groups

    print_section "✅ Validation"
    if ! validate_token; then
        print_error "Token validation failed. Please check your access token."
        exit 1
    fi

    print_section "💾 Configuration Setup"
    save_access_token
    generate_wrapper_script

    print_section "🧪 Testing"
    if ! test_mcp_server; then
        print_warning "MCP server test failed, but configuration was saved"
        print_info "You can manually test with: ~/.claude/supabase-mcp-wrapper.sh"
    fi

    print_section "🔗 Claude CLI Integration"
    remove_existing_claude_config

    if add_to_claude_cli; then
        sleep 2  # Give Claude CLI time to update
        verify_claude_integration
    else
        print_warning "Claude CLI integration failed"
        print_info "You can manually add with: claude mcp add supabase ~/.claude/supabase-mcp-wrapper.sh"
    fi

    print_section "✨ Installation Complete"
    show_summary

    print_success "Supabase MCP installation completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Open Claude CLI and run: /mcp"
    echo "2. Try some commands like: list projects, show current project"
    echo "3. Check out the documentation: https://github.com/supabase/supabase-mcp"
    echo
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi