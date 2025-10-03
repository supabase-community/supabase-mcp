import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseSupabaseConfig,
  parseKeyValueContent,
  findSupabaseTokens,
  validateConfigForClaudeCLI,
  generateClaudeCLIConfigGuidance,
  tryTokensSequentially,
  getSupabaseConfigDir,
  type SupabaseConfig
} from './supabase-config.js';
import type { ClientContext } from '../auth.js';

describe('Supabase Config Parser', () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = path.join(os.tmpdir(), `.supabase-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tempConfigPath)) {
      const stats = fs.statSync(tempConfigPath);
      if (stats.isDirectory()) {
        fs.rmSync(tempConfigPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  describe('getSupabaseConfigDir', () => {
    test('returns correct path to ~/.supabase', () => {
      const expected = path.join(os.homedir(), '.supabase');
      expect(getSupabaseConfigDir()).toBe(expected);
    });
  });

  describe('parseKeyValueContent', () => {
    test('parses simple KEY=value pairs', () => {
      const content = `
        SUPABASE_ACCESS_TOKEN=sbp_1234567890abcdef
        PROJECT_REF=my-project-ref
        OTHER_VALUE=test
      `;

      const config = parseKeyValueContent(content);

      expect(config.SUPABASE_ACCESS_TOKEN).toBe('sbp_1234567890abcdef');
      expect(config.PROJECT_REF).toBe('my-project-ref');
      expect(config.OTHER_VALUE).toBe('test');
    });

    test('handles quoted values', () => {
      const content = `
        TOKEN_SINGLE='sbp_quoted_single'
        TOKEN_DOUBLE="sbp_quoted_double"
        TOKEN_UNQUOTED=sbp_unquoted
      `;

      const config = parseKeyValueContent(content);

      expect(config.TOKEN_SINGLE).toBe('sbp_quoted_single');
      expect(config.TOKEN_DOUBLE).toBe('sbp_quoted_double');
      expect(config.TOKEN_UNQUOTED).toBe('sbp_unquoted');
    });

    test('ignores comments and empty lines', () => {
      const content = `
        # This is a comment
        VALID_TOKEN=sbp_valid_token

        # Another comment
        ANOTHER_TOKEN=sbp_another_token

        # Empty line above should be ignored
      `;

      const config = parseKeyValueContent(content);

      expect(config.VALID_TOKEN).toBe('sbp_valid_token');
      expect(config.ANOTHER_TOKEN).toBe('sbp_another_token');
      expect(Object.keys(config)).toHaveLength(2);
    });

    test('handles malformed lines gracefully', () => {
      const content = `
        VALID_TOKEN=sbp_valid_token
        MALFORMED_LINE_NO_EQUALS
        =INVALID_NO_KEY
        ANOTHER_VALID=sbp_another_valid
      `;

      const config = parseKeyValueContent(content);

      expect(config.VALID_TOKEN).toBe('sbp_valid_token');
      expect(config.ANOTHER_VALID).toBe('sbp_another_valid');
      expect(Object.keys(config)).toHaveLength(2);
    });
  });

  describe('findSupabaseTokens', () => {
    test('finds tokens with common key names', () => {
      const config: SupabaseConfig = {
        SUPABASE_ACCESS_TOKEN: 'sbp_primary_token',
        SUPABASE_TOKEN: 'sbp_secondary_token',
        ACCESS_TOKEN: 'sbp_tertiary_token',
        TOKEN: 'sbp_quaternary_token',
        OTHER_VALUE: 'not_a_token'
      };

      const tokens = findSupabaseTokens(config);

      expect(tokens).toEqual([
        'sbp_primary_token',
        'sbp_secondary_token',
        'sbp_tertiary_token',
        'sbp_quaternary_token'
      ]);
    });

    test('finds tokens with non-standard keys if they start with sbp_', () => {
      const config: SupabaseConfig = {
        CUSTOM_KEY: 'sbp_custom_token',
        ANOTHER_KEY: 'not_supabase_token',
        WEIRD_NAME: 'sbp_weird_token'
      };

      const tokens = findSupabaseTokens(config);

      expect(tokens).toEqual([
        'sbp_custom_token',
        'sbp_weird_token'
      ]);
    });

    test('returns empty array when no tokens found', () => {
      const config: SupabaseConfig = {
        SOME_KEY: 'some_value',
        ANOTHER_KEY: 'another_value'
      };

      const tokens = findSupabaseTokens(config);

      expect(tokens).toEqual([]);
    });
  });

  describe('parseSupabaseConfig', () => {
    test('successfully parses valid config directory with access-token file', () => {
      fs.mkdirSync(tempConfigPath);
      const tokenFile = path.join(tempConfigPath, 'access-token');
      fs.writeFileSync(tokenFile, 'sbp_test_token_123456789');

      const result = parseSupabaseConfig(tempConfigPath);

      expect(result.success).toBe(true);
      expect(result.tokens).toEqual(['sbp_test_token_123456789']);
    });

    test('handles non-existent directory', () => {
      const result = parseSupabaseConfig('/non/existent/directory');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Supabase config directory not found');
    });

    test('provides Claude CLI guidance for non-existent directory', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      const result = parseSupabaseConfig('/non/existent/directory', clientContext);

      expect(result.success).toBe(false);
      expect(result.claudeCLIGuidance).toContain('For Claude CLI users: Environment variables are recommended over config files');
    });

    test('provides Claude CLI guidance for existing directory', () => {
      fs.mkdirSync(tempConfigPath);
      const configFile = path.join(tempConfigPath, 'config');
      fs.writeFileSync(configFile, 'SUPABASE_ACCESS_TOKEN=sbp_test_token_123456789');

      const clientContext: ClientContext = { isClaudeCLI: true };
      const result = parseSupabaseConfig(tempConfigPath, clientContext);

      expect(result.success).toBe(true);
      expect(result.claudeCLIGuidance).toContain('Claude CLI users: Consider using environment variables instead of config files');
    });

    test('handles directory with file instead of directory', () => {
      // Create a file where a directory is expected
      fs.writeFileSync(tempConfigPath, 'this is a file, not a directory');

      const result = parseSupabaseConfig(tempConfigPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('exists but is not a directory');
    });
  });

  describe('validateConfigForClaudeCLI', () => {
    test('validates config with valid tokens', () => {
      const config: SupabaseConfig = {
        SUPABASE_ACCESS_TOKEN: 'sbp_valid_token'
      };

      const result = validateConfigForClaudeCLI(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.recommendations).toContain('For Claude CLI users, environment variables are preferred:');
    });

    test('invalidates config without tokens', () => {
      const config: SupabaseConfig = {
        SOME_KEY: 'some_value'
      };

      const result = validateConfigForClaudeCLI(config);

      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain('No valid Supabase tokens found in config file');
    });

    test('warns about large config files', () => {
      const config: SupabaseConfig = {};
      for (let i = 0; i < 10; i++) {
        config[`KEY_${i}`] = `value_${i}`;
      }

      const result = validateConfigForClaudeCLI(config);

      expect(result.warnings).toContain('Config file contains many entries - consider using environment variables for Claude CLI');
    });
  });

  describe('generateClaudeCLIConfigGuidance', () => {
    test('provides comprehensive setup guidance', () => {
      const guidance = generateClaudeCLIConfigGuidance();

      expect(guidance).toContain('🚀 Claude CLI Setup Guidance:');
      expect(guidance).toContain('1. export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"');
      expect(guidance).toContain('3. Set permissions: chmod 700 ~/.supabase && chmod 600 ~/.supabase/access-token');
      expect(guidance).toContain('Get your token at: https://supabase.com/dashboard/account/tokens');
    });
  });

  describe('tryTokensSequentially', () => {
    test('returns first valid token', async () => {
      const tokens = ['sbp_invalid', 'sbp_valid', 'sbp_another'];
      const validateFn = async (token: string) => token === 'sbp_valid';

      const result = await tryTokensSequentially(tokens, validateFn);

      expect(result.token).toBe('sbp_valid');
      expect(result.index).toBe(1);
      expect(result.error).toBeUndefined();
    });

    test('returns error when no tokens are valid', async () => {
      const tokens = ['sbp_invalid1', 'sbp_invalid2'];
      const validateFn = async (token: string) => false;

      const result = await tryTokensSequentially(tokens, validateFn);

      expect(result.token).toBeUndefined();
      expect(result.error).toContain('All provided tokens failed validation');
    });

    test('provides Claude CLI specific messaging', async () => {
      const tokens = ['sbp_invalid1', 'sbp_invalid2'];
      const validateFn = async (token: string) => false;
      const clientContext: ClientContext = { isClaudeCLI: true };

      const result = await tryTokensSequentially(tokens, validateFn, clientContext);

      expect(result.error).toContain('Check https://supabase.com/dashboard/account/tokens');
    });

    test('handles empty token array', async () => {
      const tokens: string[] = [];
      const validateFn = async (token: string) => true;

      const result = await tryTokensSequentially(tokens, validateFn);

      expect(result.error).toBe('No tokens to try');
    });

    test('handles validation function exceptions', async () => {
      const tokens = ['sbp_token'];
      const validateFn = async (token: string) => {
        throw new Error('Validation failed');
      };

      const result = await tryTokensSequentially(tokens, validateFn);

      expect(result.error).toContain('All provided tokens failed validation');
    });
  });
});