import { describe, expect, test } from 'vitest';
import {
  extractProjectId,
  getConfigSourceDescription,
  hasValidProjectCredentials,
  type ProjectContext,
} from './project-context.js';

describe('project-context core functions', () => {
  describe('extractProjectId', () => {
    test('extracts project ID from standard Supabase URL', () => {
      const url = 'https://abcdefghijklmnop.supabase.co';
      const projectId = extractProjectId(url);
      expect(projectId).toBe('abcdefghijklmnop');
    });

    test('extracts project ID from supabase.in domain', () => {
      const url = 'https://test123project.supabase.in';
      const projectId = extractProjectId(url);
      expect(projectId).toBe('test123project');
    });

    test('extracts project ID from supabase.io domain', () => {
      const url = 'https://myproject456.supabase.io';
      const projectId = extractProjectId(url);
      expect(projectId).toBe('myproject456');
    });

    test('extracts project ID from URL with path', () => {
      const url = 'https://custom.example.com/project/abcd1234efgh';
      const projectId = extractProjectId(url);
      expect(projectId).toBe('abcd1234efgh');
    });

    test('returns undefined for invalid URL', () => {
      const projectId = extractProjectId('not-a-url');
      expect(projectId).toBeUndefined();
    });

    test('returns undefined for URL without project ID', () => {
      const url = 'https://example.com';
      const projectId = extractProjectId(url);
      expect(projectId).toBeUndefined();
    });

    test('handles example URLs like magic links', () => {
      // Based on user's example
      const url = 'https://uhnymifvdauzlmaogjfj.supabase.co/auth/v1/verify';
      const projectId = extractProjectId(url);
      expect(projectId).toBe('uhnymifvdauzlmaogjfj');
    });
  });

  describe('getConfigSourceDescription', () => {
    test('returns correct descriptions for each source type', () => {
      expect(getConfigSourceDescription('env')).toBe('.env file');
      expect(getConfigSourceDescription('env.local')).toBe('.env.local file');
      expect(getConfigSourceDescription('supabase-config')).toBe('.supabase/config.toml file');
      expect(getConfigSourceDescription('supabase-env')).toBe('.supabase/.env file');
      expect(getConfigSourceDescription('none')).toBe('no project configuration found');
    });
  });

  describe('hasValidProjectCredentials', () => {
    test('returns true for valid credentials with anon key', () => {
      const context: ProjectContext = {
        directory: '/test',
        credentials: {
          supabaseUrl: 'https://test.supabase.co',
          anonKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test',
        },
        configSource: 'env',
        hasProjectConfig: true,
      };

      expect(hasValidProjectCredentials(context)).toBe(true);
    });

    test('returns true for valid credentials with service role key', () => {
      const context: ProjectContext = {
        directory: '/test',
        credentials: {
          supabaseUrl: 'https://test.supabase.co',
          serviceRoleKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test',
        },
        configSource: 'env',
        hasProjectConfig: true,
      };

      expect(hasValidProjectCredentials(context)).toBe(true);
    });

    test('returns true for valid credentials with both keys', () => {
      const context: ProjectContext = {
        directory: '/test',
        credentials: {
          supabaseUrl: 'https://test.supabase.co',
          anonKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.anon',
          serviceRoleKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.service',
        },
        configSource: 'env',
        hasProjectConfig: true,
      };

      expect(hasValidProjectCredentials(context)).toBe(true);
    });

    test('returns false for missing URL', () => {
      const context: ProjectContext = {
        directory: '/test',
        credentials: {
          anonKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test',
        },
        configSource: 'env',
        hasProjectConfig: true,
      };

      expect(hasValidProjectCredentials(context)).toBe(false);
    });

    test('returns false for missing keys', () => {
      const context: ProjectContext = {
        directory: '/test',
        credentials: {
          supabaseUrl: 'https://test.supabase.co',
        },
        configSource: 'env',
        hasProjectConfig: true,
      };

      expect(hasValidProjectCredentials(context)).toBe(false);
    });

    test('returns false for empty credentials', () => {
      const context: ProjectContext = {
        directory: '/test',
        credentials: {},
        configSource: 'none',
        hasProjectConfig: false,
      };

      expect(hasValidProjectCredentials(context)).toBe(false);
    });
  });
});