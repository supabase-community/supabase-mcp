import { describe, expect, test } from 'vitest';
import {
  validateAndSanitizeToken,
  detectClientContext,
  generateAuthErrorMessage,
  resolveAccessToken,
  validateAuthenticationSetup,
  supabaseTokenSchema,
  resolveTokenFromConfig,
  type TokenResolutionResult,
} from './auth.js';

describe('auth utilities', () => {
  describe('supabaseTokenSchema', () => {
    test('validates correct Supabase token format', () => {
      const validToken = 'sbp_1234567890abcdef12345678';
      expect(() => supabaseTokenSchema.parse(validToken)).not.toThrow();
    });

    test('rejects invalid token formats', () => {
      const invalidTokens = [
        '',
        'invalid',
        'sk_1234567890abcdef',  // Wrong prefix
        'sbp_',  // Too short
        'sbp_123',  // Too short
        'sbp_invalid!@#',  // Invalid characters
      ];

      invalidTokens.forEach(token => {
        expect(() => supabaseTokenSchema.parse(token)).toThrow();
      });
    });
  });

  describe('validateAndSanitizeToken', () => {
    test('validates and sanitizes correct token', () => {
      const token = 'sbp_1234567890abcdef12345678';
      const result = validateAndSanitizeToken(token);

      expect(result.isValid).toBe(true);
      expect(result.sanitizedToken).toBe(token);
      expect(result.error).toBeUndefined();
    });

    test('sanitizes token with quotes and whitespace', () => {
      const token = '  "sbp_1234567890abcdef12345678"  ';
      const result = validateAndSanitizeToken(token);

      expect(result.isValid).toBe(true);
      expect(result.sanitizedToken).toBe('sbp_1234567890abcdef12345678');
    });

    test('handles undefined token', () => {
      const result = validateAndSanitizeToken(undefined);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('No access token provided');
      expect(result.suggestions).toContain('Set the SUPABASE_ACCESS_TOKEN environment variable');
    });

    test('provides specific suggestions for invalid tokens', () => {
      const result = validateAndSanitizeToken('invalid_token');

      expect(result.isValid).toBe(false);
      expect(result.suggestions).toContain('Supabase access tokens must start with "sbp_"');
      expect(result.suggestions).toContain('Generate a new token at https://supabase.com/dashboard/account/tokens');
    });

    test('detects truncated tokens', () => {
      const result = validateAndSanitizeToken('sbp_123');

      expect(result.isValid).toBe(false);
      expect(result.suggestions).toContain('Token appears to be incomplete or truncated');
    });
  });

  describe('detectClientContext', () => {
    test('detects Claude CLI from client info', () => {
      const clientInfo = { name: 'claude-cli', version: '1.0.0' };
      const context = detectClientContext(clientInfo);

      expect(context.isClaudeCLI).toBe(true);
      expect(context.clientInfo).toBe(clientInfo);
    });

    test('detects Claude CLI from user agent', () => {
      const userAgent = 'claude-mcp/1.0.0';
      const context = detectClientContext(undefined, userAgent);

      expect(context.isClaudeCLI).toBe(true);
      expect(context.userAgent).toBe(userAgent);
    });

    test('detects non-Claude CLI clients', () => {
      const clientInfo = { name: 'cursor', version: '1.0.0' };
      const context = detectClientContext(clientInfo);

      expect(context.isClaudeCLI).toBe(false);
      expect(context.clientInfo).toBe(clientInfo);
    });

    test('handles undefined inputs', () => {
      const context = detectClientContext();

      expect(context.isClaudeCLI).toBe(false);
      expect(context.clientInfo).toBeUndefined();
      expect(context.userAgent).toBeUndefined();
    });
  });

  describe('generateAuthErrorMessage', () => {
    test('generates Claude CLI specific error message', () => {
      const clientContext = { isClaudeCLI: true };
      const tokenValidation = {
        error: 'Invalid token format',
        suggestions: ['Check token format']
      };

      const message = generateAuthErrorMessage(
        'Unauthorized',
        clientContext,
        tokenValidation
      );

      expect(message).toContain('For Claude CLI users:');
      expect(message).toContain('Restart Claude CLI after setting the environment variable');
      expect(message).toContain('Token validation issues:');
      expect(message).toContain('Check token format');
    });

    test('generates generic MCP client error message', () => {
      const clientContext = { isClaudeCLI: false };
      const message = generateAuthErrorMessage('Unauthorized', clientContext);

      expect(message).toContain('For MCP client users:');
      expect(message).toContain('Set SUPABASE_ACCESS_TOKEN in your MCP client configuration');
      expect(message).not.toContain('Claude CLI');
    });

    test('includes general troubleshooting steps', () => {
      const clientContext = { isClaudeCLI: false };
      const message = generateAuthErrorMessage('Unauthorized', clientContext);

      expect(message).toContain('General troubleshooting:');
      expect(message).toContain('Verify the token at https://supabase.com/dashboard/account/tokens');
      expect(message).toContain('Ensure the token has not expired');
    });
  });

  describe('resolveAccessToken', () => {
    test('prioritizes CLI token over environment token', () => {
      const result = resolveAccessToken({
        cliToken: 'sbp_cli_token_1234567890abcdef',
        envToken: 'sbp_env_token_1234567890abcdef',
      });

      expect(result.source).toBe('cli');
      expect(result.token).toBe('sbp_cli_token_1234567890abcdef');
      expect(result.validation.isValid).toBe(true);
    });

    test('falls back to environment token', () => {
      const result = resolveAccessToken({
        envToken: 'sbp_env_token_1234567890abcdef',
      });

      expect(result.source).toBe('env');
      expect(result.token).toBe('sbp_env_token_1234567890abcdef');
      expect(result.validation.isValid).toBe(true);
    });

    test('falls back to config file tokens', () => {
      const result = resolveAccessToken({
        configFileTokens: ['sbp_config_token_1234567890abcdef'],
      });

      expect(result.source).toBe('config');
      expect(result.token).toBe('sbp_config_token_1234567890abcdef');
      expect(result.validation.isValid).toBe(true);
    });

    test('tries multiple config file tokens until valid one found', () => {
      const result = resolveAccessToken({
        configFileTokens: ['invalid_token', 'sbp_valid_token_1234567890abcdef', 'sbp_another_token'],
      });

      expect(result.source).toBe('config');
      expect(result.token).toBe('sbp_valid_token_1234567890abcdef');
      expect(result.validation.isValid).toBe(true);
    });

    test('provides Claude CLI warnings when using config file tokens', () => {
      const clientContext = { isClaudeCLI: true };
      const result = resolveAccessToken({
        configFileTokens: ['sbp_config_token_1234567890abcdef'],
        clientContext,
      });

      expect(result.source).toBe('config');
      expect(result.claudeCLIWarnings).toContain('Claude CLI: Using ~/.supabase config file.');
    });

    test('provides Claude CLI guidance when using environment variables', () => {
      const clientContext = { isClaudeCLI: true };
      const result = resolveAccessToken({
        envToken: 'sbp_env_token_1234567890abcdef',
        clientContext,
      });

      expect(result.source).toBe('env');
      expect(result.claudeCLIWarnings).toBeUndefined();
    });

    test('handles no token provided with Claude CLI guidance', () => {
      const clientContext = { isClaudeCLI: true };
      const result = resolveAccessToken({
        clientContext,
      });

      expect(result.source).toBe('none');
      expect(result.token).toBeUndefined();
      expect(result.validation.isValid).toBe(false);
      expect(result.configGuidance).toContain('Claude CLI Setup Options:');
    });

    test('validates token format', () => {
      const result = resolveAccessToken({
        cliToken: 'invalid_token',
      });

      expect(result.source).toBe('cli');
      expect(result.token).toBeUndefined();
      expect(result.validation.isValid).toBe(false);
      expect(result.validation.error).toContain('Invalid Supabase access token format');
    });

    test('handles invalid config file tokens', () => {
      const result = resolveAccessToken({
        configFileTokens: ['invalid_token1', 'invalid_token2'],
      });

      expect(result.source).toBe('config');
      expect(result.token).toBeUndefined();
      expect(result.validation.isValid).toBe(false);
      expect(result.validation.error).toBe('No valid tokens found in config file');
    });
  });

  describe('resolveTokenFromConfig', () => {
    test('handles non-existent config directory', async () => {
      // Test behavior when user doesn't have a .supabase directory at all
      // This might return real tokens if user has actual config, which is expected behavior
      const result = await resolveTokenFromConfig();

      expect(result.configResult).toBeDefined();
      // Don't assert on tokens since user might have real tokens
    });

    test('provides Claude CLI guidance for config directory', async () => {
      const clientContext = { isClaudeCLI: true };
      const result = await resolveTokenFromConfig(clientContext);

      expect(result.claudeCLIGuidance).toBeDefined();
      // Should provide Claude CLI specific guidance regardless of whether config exists
    });
  });

  describe('validateAuthenticationSetup', () => {
    test('validates successful setup', () => {
      const tokenResolution: TokenResolutionResult = {
        token: 'sbp_valid_token_1234567890abcdef',
        source: 'env' as const,
        validation: { isValid: true }
      };
      const clientContext = { isClaudeCLI: false };

      const result = validateAuthenticationSetup(tokenResolution, clientContext);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('handles invalid token setup', () => {
      const tokenResolution: TokenResolutionResult = {
        token: undefined,
        source: 'none' as const,
        validation: {
          isValid: false,
          error: 'No access token provided',
          suggestions: ['Set SUPABASE_ACCESS_TOKEN']
        }
      };
      const clientContext = { isClaudeCLI: true };

      const result = validateAuthenticationSetup(tokenResolution, clientContext);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('No access token provided');
      expect(result.error).toContain('For Claude CLI users:');
    });

    test('provides warnings for CLI token with Claude CLI', () => {
      const tokenResolution: TokenResolutionResult = {
        token: 'sbp_valid_token_1234567890abcdef',
        source: 'cli' as const,
        validation: { isValid: true }
      };
      const clientContext = { isClaudeCLI: true };

      const result = validateAuthenticationSetup(tokenResolution, clientContext);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        'Consider setting SUPABASE_ACCESS_TOKEN environment variable for Claude CLI'
      );
    });

    test('provides warnings for config file usage with Claude CLI', () => {
      const tokenResolution: TokenResolutionResult = {
        token: 'sbp_valid_token_1234567890abcdef',
        source: 'config' as const,
        validation: { isValid: true },
        claudeCLIWarnings: ['Using ~/.supabase config file with Claude CLI']
      };
      const clientContext = { isClaudeCLI: true };

      const result = validateAuthenticationSetup(tokenResolution, clientContext);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Using ~/.supabase config file with Claude CLI');
      expect(result.warnings).toContain('Environment variables are recommended for better Claude CLI integration');
    });

    test('provides config guidance when no token found', () => {
      const tokenResolution: TokenResolutionResult = {
        token: undefined,
        source: 'none' as const,
        validation: {
          isValid: false,
          error: 'No access token provided'
        },
        configGuidance: ['Claude CLI Setup Options:', 'Use environment variables']
      };
      const clientContext = { isClaudeCLI: true };

      const result = validateAuthenticationSetup(tokenResolution, clientContext);

      expect(result.isValid).toBe(false);
      expect(result.claudeCLIGuidance).toContain('Claude CLI Setup Options:');
    });
  });
});