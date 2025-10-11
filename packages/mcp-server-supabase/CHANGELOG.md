# Changelog

All notable changes to the Supabase MCP Server will be documented in this file.

## [Unreleased]

### Added - Database Backup & Recovery Tools
- **New MCP Tools**
  - `undo_database_restore` - Reverts database to pre-restoration state (destructive operation)
  - `list_restore_points` - Lists available point-in-time recovery (PITR) restore points
  - `create_restore_point` - Creates manual database backup/restore point

- **Platform Updates**
  - Implemented complete `BackupOperations` interface with 7 backup-related methods
  - Added restore point management API integration
  - Full point-in-time recovery (PITR) support
  - Defensive coding for varying API response structures

### Added - Domain & Database Configuration Tools
- **New MCP Tools**
  - `get_postgrest_config` - Retrieves PostgREST service configuration
  - `update_postgrest_config` - Updates PostgREST max_rows, db_schema, and other settings
  - `get_pgsodium_config` - Retrieves pgsodium encryption configuration
  - `update_pgsodium_config` - Updates pgsodium encryption keys (destructive - can break existing encrypted data)

- **Platform Updates**
  - Implemented complete `CustomDomainOperations` interface with 11 domain management methods:
    - Custom hostname management (create, activate, verify, delete)
    - Vanity subdomain management (create, check availability, activate, delete)
    - DNS configuration and verification support
  - Implemented complete `DatabaseConfigOperations` interface with 13 configuration methods:
    - PostgreSQL configuration (GET/PUT)
    - Connection pooler (pgbouncer/supavisor) configuration
    - PostgREST configuration
    - pgsodium encryption configuration
    - Database webhooks enablement
    - Read replica management
  - All 11 domain tools in `domain-tools.ts` now fully functional with platform backing
  - Added pgsodium configuration methods to platform interface

- **Notes**
  - Domain tools were previously defined but not wired to the platform - now fully operational
  - Some interface methods (`configurePitr`, `managePgSodium`) throw errors as Management API lacks dedicated endpoints
  - Read replica setup/removal uses dedicated `/setup` and `/remove` endpoints

### Added - SQL Snippets Management Tools
- **New MCP Tools**
  - `list_sql_snippets` - Lists all SQL snippets for the logged-in user, with optional project filtering
  - `get_sql_snippet` - Retrieves a specific SQL snippet by ID with full content and metadata

- **Features**
  - Read-only access to user's SQL snippets created in Supabase Studio
  - Optional project-based filtering for snippet listing
  - Detailed snippet information including:
    - SQL content and schema version
    - Snippet metadata (name, description, visibility, favorite status)
    - Project and user associations (owner, last updated by)
    - Timestamps (created, updated)
  - Response size limiting for large snippet lists (max 100 snippets)

- **Notes**
  - Snippets are managed through Supabase Studio UI
  - Management API provides read-only access only (no create/update/delete operations)
  - Tools are part of the 'database' feature group

### Added - Claude CLI Optimization Update
- **Enhanced Authentication System**
  - Comprehensive token format validation with sanitization
  - Claude CLI specific client detection and error messaging
  - Multiple token source support (CLI flags, environment variables, config files)
  - Startup token validation to catch errors early
  - Context-aware error messages based on detected MCP client

- **Automatic Project Context Detection**
  - Smart detection of Supabase project configuration from current working directory
  - Support for `.env`, `.env.local`, `.supabase/config.toml`, and `.supabase/.env` files
  - Framework-specific environment variable support (Next.js, React, Vite)
  - Automatic project switching based on detected project credentials
  - Priority-based configuration resolution system

- **Enhanced Personal Access Token Detection**
  - Automatic detection from `~/.supabase/access-token` (Supabase CLI integration)
  - Support for multiple token file formats and locations
  - Fallback chain: Environment → CLI directory → Config files
  - Seamless integration with `supabase login` workflow

- **~/.supabase Config File Support**
  - Automatic detection and parsing of ~/.supabase configuration file
  - KEY=value format support with fallback to multiple tokens
  - Claude CLI-specific warnings about config file usage
  - Environment variable recommendations for Claude CLI users

- **Runtime Mode Management (Claude CLI Optimized)**
  - Interactive read-only/write mode toggling with confirmations
  - Claude CLI-specific status indicators (🔒 read-only, 🔓 write mode)
  - Security validation and warnings for destructive operations
  - Real-time mode status monitoring and guidance

- **Interactive Project Switching**
  - Multi-project detection and formatted project lists for Claude CLI
  - Interactive project selection by ID or name
  - Project status indicators and detailed information display
  - Seamless runtime project switching with validation

- **New Runtime Tools Feature Group**
  - `toggle_read_only_mode`: Interactive mode switching with confirmations
  - `get_runtime_mode_status`: Current mode status with security info
  - `set_read_only_mode`: Explicit mode setting with validation
  - `validate_mode_change`: Pre-validation of mode change requirements
  - `switch_project`: Interactive project switching for multi-project setups
  - `get_current_project`: Current project details and status
  - `list_projects`: All available projects with Claude CLI formatting

- **Comprehensive Test Suite**
  - Config file parser tests with various input scenarios
  - Mode manager tests covering all Claude CLI interactions
  - Enhanced authentication tests for config file integration
  - Token resolution tests with multiple source priorities

### Changed
- **Authentication Architecture Overhaul**
  - Dual authentication modes: personal-token vs project-keys
  - Project-specific API key usage when available
  - Enhanced fallback chains for token resolution
  - Automatic context switching based on working directory

- **Claude CLI Integration Priority**
  - Environment variables now preferred over config files for Claude CLI
  - All error messages include Claude CLI-specific guidance when detected
  - Interactive confirmations optimized for conversational AI interface
  - Tool descriptions and help text tailored for Claude CLI context

- **Token Resolution Priority**
  - Updated priority: CLI flags → Environment variables → Project context → Config file → None
  - Enhanced validation with detailed error messages and suggestions
  - Multi-token fallback support with sequential validation
  - Project-specific credential extraction and validation

- **Feature Group System**
  - Added 'runtime' feature group enabled by default
  - Updated default features to include runtime tools
  - Enhanced feature documentation with Claude CLI focus

### Fixed
- Better handling of malformed or invalid access tokens
- Improved error reporting with client-specific guidance
- Enhanced token parsing to handle whitespace, quotes, and formatting issues
- Config file permission warnings and security validation
- Graceful fallback handling when no valid tokens found

### Security
- Token format validation to prevent injection attacks
- Config file permission checking and warnings
- Interactive confirmations for potentially destructive operations
- Enhanced authentication logging without exposing sensitive information
- Mode change validation with security risk assessment

## [0.5.5] - Previous Release

### Added
- Initial MCP server implementation
- Supabase platform integration
- Basic authentication support
- Core tool functionality

---

This changelog follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.