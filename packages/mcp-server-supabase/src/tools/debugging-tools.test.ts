/**
 * Tests for enhanced debugging tools with response management
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getDebuggingTools } from './debugging-tools.js';
import type { DebuggingOperations } from '../platform/types.js';
import { limitResponseSize } from '../response/index.js';

// Mock the response processing
vi.mock('../response/index.js', () => ({
  limitResponseSize: vi.fn((data, context, config) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const tokens = Math.ceil(jsonStr.length / 4);
    const maxTokens = config?.maxTokens || 20000;

    if (tokens > maxTokens) {
      return `${context} (response size reduced from ~${tokens} to ~${maxTokens} tokens)\n\n${jsonStr.substring(0, maxTokens * 4)}...`;
    }
    return `${context}\n\n${jsonStr}`;
  }),
}));

describe('Enhanced Debugging Tools', () => {
  let mockDebuggingOps: DebuggingOperations;
  let tools: ReturnType<typeof getDebuggingTools>;

  // Mock log entries (simulating various log levels and services)
  const mockLogEntries = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      level: 'info',
      msg: 'User login successful',
      user_id: '123',
      service: 'auth',
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      level: 'error',
      msg: 'Database connection failed',
      error: 'Connection timeout',
      service: 'postgres',
    },
    {
      timestamp: '2024-01-01T10:02:00Z',
      level: 'warn',
      msg: 'High memory usage detected',
      memory_usage: '85%',
      service: 'api',
    },
    {
      timestamp: '2024-01-01T10:03:00Z',
      level: 'debug',
      msg: 'Cache hit for user profile',
      cache_key: 'user:123:profile',
      service: 'api',
    },
    {
      timestamp: '2024-01-01T10:04:00Z',
      level: 'error',
      msg: 'Function execution failed',
      function_name: 'process-payment',
      error: 'Invalid payment method',
      service: 'edge-function',
    },
  ];

  // Mock advisor entries (security and performance)
  const mockSecurityAdvisors = [
    {
      title: 'Missing RLS Policy',
      severity: 'critical',
      category: 'security',
      description: 'Table "users" has no Row Level Security policies defined',
      remediation_url: 'https://supabase.com/docs/guides/security/rls',
      action_required: 'Create RLS policies for the users table',
    },
    {
      title: 'Weak Password Policy',
      severity: 'medium',
      category: 'security',
      description: 'Password requirements could be stronger',
      remediation_url: 'https://supabase.com/docs/guides/auth/password-policy',
      action_required: 'Review and strengthen password requirements',
    },
  ];

  const mockPerformanceAdvisors = [
    {
      title: 'Missing Database Index',
      severity: 'high',
      category: 'performance',
      description: 'Query on users.email column would benefit from an index',
      remediation_url: 'https://supabase.com/docs/guides/performance/indexes',
      action_required: 'Create index on users.email column',
    },
    {
      title: 'Large Table Without Partitioning',
      severity: 'low',
      category: 'performance',
      description: 'Table "logs" has over 1M rows and could benefit from partitioning',
      remediation_url: 'https://supabase.com/docs/guides/performance/partitioning',
      action_required: 'Consider partitioning the logs table',
    },
  ];

  beforeEach(() => {
    mockDebuggingOps = {
      getLogs: vi.fn().mockResolvedValue(mockLogEntries),
      getSecurityAdvisors: vi.fn().mockResolvedValue(mockSecurityAdvisors),
      getPerformanceAdvisors: vi.fn().mockResolvedValue(mockPerformanceAdvisors),
      getProjectHealth: vi.fn().mockResolvedValue({
        status: 'healthy',
        services: {
          postgres: 'running',
          api: 'running',
          auth: 'running',
          storage: 'running',
        },
      }),
      getUpgradeStatus: vi.fn().mockResolvedValue({
        current_version: '1.2.3',
        latest_version: '1.2.4',
        upgrade_available: true,
      }),
      checkUpgradeEligibility: vi.fn().mockResolvedValue({
        eligible: true,
        requirements: ['Database must be backed up', 'No active migrations'],
      }),
    };

    tools = getDebuggingTools({
      debugging: mockDebuggingOps,
      projectId: 'test-project',
    });

    // Clear mocks before each test
    vi.clearAllMocks();
  });

  describe('get_logs', () => {
    test('should filter logs by level (error only)', async () => {
      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '5min',
        log_level_filter: 'error',
        max_entries: 50,
        response_format: 'detailed',
      });

      // Verify filtering worked in the processed response
      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ level: 'error' }),
        ]),
        expect.stringContaining('api service logs (5min window) (error+ level)'),
        { maxTokens: 12000 } // detailed format
      );
    });

    test('should filter logs by search pattern', async () => {
      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'auth',
        time_window: '1min',
        log_level_filter: 'all',
        search_pattern: 'login',
        max_entries: 50,
        response_format: 'detailed',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedLogs = processedCall[0];

      // Should only include logs containing 'login'
      expect(processedLogs.every((log: any) =>
        JSON.stringify(log).toLowerCase().includes('login')
      )).toBe(true);
    });

    test('should use compact response format', async () => {
      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'postgres',
        time_window: '15min',
        log_level_filter: 'all',
        max_entries: 25,
        response_format: 'compact',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            timestamp: expect.any(String),
            level: expect.any(String),
            message: expect.any(String),
            service: 'postgres',
          }),
        ]),
        expect.stringContaining('postgres service logs'),
        { maxTokens: 8000 } // compact/summary format
      );
    });

    test('should use errors_only response format', async () => {
      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'edge-function',
        time_window: '1hour',
        log_level_filter: 'all',
        max_entries: 10,
        response_format: 'errors_only',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            level: expect.stringMatching(/error|warn/i),
          }),
        ]),
        expect.stringContaining('edge-function service logs'),
        { maxTokens: 5000 } // errors_only/critical_only format
      );
    });

    test('should limit results to max_entries', async () => {
      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'all',
        max_entries: 2,
        response_format: 'detailed',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedLogs = processedCall[0];

      expect(processedLogs).toHaveLength(2);
    });
  });

  describe('get_advisors', () => {
    test('should get security advisors with filtering', async () => {
      const result = await tools.get_advisors.execute({
        project_id: 'test-project',
        type: 'security',
        severity_filter: 'critical',
        response_format: 'detailed',
      });

      expect(mockDebuggingOps.getSecurityAdvisors).toHaveBeenCalledWith('test-project');

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedAdvisors = processedCall[0];

      // Should only include critical advisors
      expect(processedAdvisors.every((advisor: any) =>
        advisor.severity === 'critical'
      )).toBe(true);
      expect(processedCall[1]).toContain('security advisors (critical+ severity)');
    });

    test('should get performance advisors with summary format', async () => {
      const result = await tools.get_advisors.execute({
        project_id: 'test-project',
        type: 'performance',
        severity_filter: 'all',
        response_format: 'summary',
      });

      expect(mockDebuggingOps.getPerformanceAdvisors).toHaveBeenCalledWith('test-project');

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            title: expect.any(String),
            severity: expect.any(String),
            category: 'performance',
            summary: expect.stringContaining('...'),
            remediation_url: expect.any(String),
          }),
        ]),
        expect.stringContaining('performance advisors'),
        { maxTokens: 8000 } // compact/summary format
      );
    });

    test('should filter to critical_only format', async () => {
      const result = await tools.get_advisors.execute({
        project_id: 'test-project',
        type: 'security',
        severity_filter: 'all',
        response_format: 'critical_only',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedAdvisors = processedCall[0];

      // Should only include critical/high severity advisors
      expect(processedAdvisors.every((advisor: any) =>
        advisor.severity === 'critical' || advisor.severity === 'high'
      )).toBe(true);

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        { maxTokens: 5000 } // errors_only/critical_only format
      );
    });
  });

  describe('response configuration selection', () => {
    test('should use DATABASE_RESULTS config for detailed format', async () => {
      await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'all',
        response_format: 'detailed',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        { maxTokens: 12000 } // detailed format
      );
    });

    test('should use STANDARD config for compact format', async () => {
      await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'all',
        response_format: 'compact',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        { maxTokens: 8000 } // compact/summary format
      );
    });

    test('should use CONSERVATIVE config for errors_only format', async () => {
      await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'all',
        response_format: 'errors_only',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        { maxTokens: 5000 } // errors_only/critical_only format
      );
    });
  });

  describe('existing tools (unchanged)', () => {
    test('get_project_health should work unchanged', async () => {
      const result = await tools.get_project_health.execute({
        project_id: 'test-project',
      });

      expect(mockDebuggingOps.getProjectHealth).toHaveBeenCalledWith('test-project');
      expect(result).toEqual({
        status: 'healthy',
        services: {
          postgres: 'running',
          api: 'running',
          auth: 'running',
          storage: 'running',
        },
      });
    });

    test('get_upgrade_status should work unchanged', async () => {
      const result = await tools.get_upgrade_status.execute({
        project_id: 'test-project',
      });

      expect(mockDebuggingOps.getUpgradeStatus).toHaveBeenCalledWith('test-project');
      expect(result).toEqual({
        current_version: '1.2.3',
        latest_version: '1.2.4',
        upgrade_available: true,
      });
    });

    test('check_upgrade_eligibility should work unchanged', async () => {
      const result = await tools.check_upgrade_eligibility.execute({
        project_id: 'test-project',
      });

      expect(mockDebuggingOps.checkUpgradeEligibility).toHaveBeenCalledWith('test-project');
      expect(result).toEqual({
        eligible: true,
        requirements: ['Database must be backed up', 'No active migrations'],
      });
    });
  });

  describe('parameter validation and edge cases', () => {
    test('should handle empty log responses', async () => {
      vi.mocked(mockDebuggingOps.getLogs).mockResolvedValueOnce([]);

      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'all',
        response_format: 'detailed',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [],
        expect.stringContaining('(0 entries)'),
        { maxTokens: 12000 } // detailed format
      );
    });

    test('should handle non-array log responses', async () => {
      vi.mocked(mockDebuggingOps.getLogs).mockResolvedValueOnce(null as any);

      const result = await tools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'all',
        response_format: 'detailed',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [],
        expect.stringContaining('(0 entries)'),
        { maxTokens: 12000 } // detailed format
      );
    });

    test('should handle empty advisor responses', async () => {
      vi.mocked(mockDebuggingOps.getSecurityAdvisors).mockResolvedValueOnce([]);

      const result = await tools.get_advisors.execute({
        project_id: 'test-project',
        type: 'security',
        severity_filter: 'all',
        response_format: 'detailed',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [],
        expect.stringContaining('(0 issues)'),
        { maxTokens: 12000 } // detailed format
      );
    });
  });
});