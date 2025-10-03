# Claude CLI Integration Improvements

This document summarizes the enhancements made to improve the Supabase MCP server's integration with Claude CLI and other MCP clients.

## Overview

The improvements focus on three main areas:
1. **Enhanced Authentication & Token Handling**
2. **Claude CLI-Specific Error Messaging**
3. **Improved User Experience & Debugging**

## Key Improvements

### 1. Enhanced Token Validation (`src/auth.ts`)

**New Features:**
- **Token Format Validation**: Validates Supabase token format (`sbp_*`) with proper regex patterns
- **Token Sanitization**: Removes quotes, whitespace, and other common formatting issues
- **Early Validation**: Validates tokens at startup rather than waiting for API calls
- **Flexible Token Length**: Supports various Supabase token lengths while maintaining security

**Code Example:**
```typescript
const result = validateAndSanitizeToken('  "sbp_1234567890abcdef"  ');
// Returns: { isValid: true, sanitizedToken: 'sbp_1234567890abcdef' }
```

### 2. Client Detection & Context-Aware Messaging

**New Features:**
- **Claude CLI Detection**: Automatically detects when running under Claude CLI
- **Context-Aware Errors**: Provides different error messages based on the detected client
- **User Agent Analysis**: Uses client info and user agent for better detection

**Code Example:**
```typescript
const clientContext = detectClientContext(clientInfo, userAgent);
if (clientContext.isClaudeCLI) {
  // Provide Claude CLI-specific guidance
}
```

### 3. Enhanced Error Handling (`src/management-api/index.ts`)

**Improvements:**
- **Detailed Debug Logging**: Enhanced 401 error logging with client context
- **Progressive Error Messages**: Structured error messages with actionable steps
- **Client-Specific Guidance**: Different troubleshooting steps for Claude CLI vs other clients

**Before:**
```
Unauthorized. Please provide a valid access token to the MCP server via the --access-token flag or SUPABASE_ACCESS_TOKEN.
```

**After:**
```
Unauthorized: Invalid or expired access token.

For Claude CLI users:
1. Ensure SUPABASE_ACCESS_TOKEN is set in your environment
2. Restart Claude CLI after setting the environment variable
3. Check your MCP server configuration in Claude CLI settings

Token validation issues:
- Supabase access tokens must start with "sbp_"
- Generate a new token at https://supabase.com/dashboard/account/tokens

General troubleshooting:
- Verify the token at https://supabase.com/dashboard/account/tokens
- Ensure the token has not expired
- Check that the token has appropriate permissions
```

### 4. Startup Authentication Validation (`src/transports/stdio.ts`)

**New Features:**
- **Startup Token Resolution**: Validates tokens before server initialization
- **Multiple Token Sources**: CLI flags, environment variables with proper priority
- **Warning System**: Provides warnings for suboptimal configurations
- **Graceful Failure**: Clear error messages when authentication fails

### 5. Comprehensive Testing (`src/auth.test.ts`)

**Test Coverage:**
- Token format validation and sanitization
- Client context detection for Claude CLI
- Error message generation for different scenarios
- Token resolution with multiple sources
- Authentication setup validation

## Usage Examples

### For Claude CLI Users

1. **Set Environment Variable:**
   ```bash
   export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"
   ```

2. **Restart Claude CLI** to pick up the new environment variable

3. **The server will automatically:**
   - Detect Claude CLI usage
   - Validate token format
   - Provide Claude CLI-specific error messages if issues occur

### For Other MCP Clients

The improvements are backward compatible and provide enhanced error messaging for all MCP clients, with specific optimizations for Claude CLI.

## Configuration Files Updated

### `server.json`
- Enhanced environment variable description with token format information
- Added link to Supabase token generation page

### `README.md`
- New "Claude CLI Configuration" section
- Detailed troubleshooting guide
- Enhanced setup instructions

## Security Considerations

- **Token Validation**: Prevents malformed tokens from reaching the API
- **Input Sanitization**: Safely handles user input with proper validation
- **Error Information**: Avoids leaking sensitive information in error messages
- **Debug Logging**: Comprehensive logging for security monitoring without exposing secrets

## Migration Guide

These improvements are **fully backward compatible**. Existing MCP server configurations will continue to work without any changes.

**Optional Improvements:**
- Set `SUPABASE_ACCESS_TOKEN` as an environment variable for better Claude CLI experience
- Update MCP client configurations to use environment variables instead of CLI flags

## Testing

Run the comprehensive test suite:
```bash
pnpm test:unit -- src/auth.test.ts
```

All existing tests continue to pass, with additional coverage for the new authentication features.

## Future Enhancements

Potential areas for future improvement:
1. **Token Expiration Detection**: Check token expiration before API calls
2. **Credential Refresh**: Automatic token refresh mechanisms
3. **Multiple Token Support**: Support for different token types
4. **Advanced Client Detection**: More sophisticated client detection logic
5. **Metrics & Analytics**: Usage analytics for different client types