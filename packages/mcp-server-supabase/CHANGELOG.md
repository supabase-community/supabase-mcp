# Changelog

All notable changes to the Supabase MCP Server will be documented in this file.

## [Unreleased]

### Added - Claude CLI Optimization Update
- **Enhanced Authentication System**
  - Comprehensive token format validation with sanitization
  - Claude CLI specific client detection and error messaging
  - Multiple token source support (CLI flags, environment variables, config files)
  - Startup token validation to catch errors early
  - Context-aware error messages based on detected MCP client

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
- **Claude CLI Integration Priority**
  - Environment variables now preferred over config files for Claude CLI
  - All error messages include Claude CLI-specific guidance when detected
  - Interactive confirmations optimized for conversational AI interface
  - Tool descriptions and help text tailored for Claude CLI context

- **Token Resolution Priority**
  - Updated priority: CLI flags → Environment variables → Config file → None
  - Enhanced validation with detailed error messages and suggestions
  - Multi-token fallback support with sequential validation

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