import { describe, expect, test, beforeEach } from 'vitest';
import {
  initializeModeManager,
  getModeManager,
  toggleReadOnlyModeForClaudeCLI,
  getCurrentModeStatus,
  getClaudeCLIStatusDisplay,
  validateModeChangeWithClaudeCLI,
  resetModeManager,
  type RuntimeMode,
  type ModeChangeResult,
} from './mode-manager.js';
import type { ClientContext } from '../auth.js';

describe('Mode Manager', () => {
  describe('initialization and basic operations', () => {
    test('initializes with read-only mode by default', () => {
      initializeModeManager(true);
      const manager = getModeManager();
      const mode = manager.getCurrentMode();

      expect(mode.readOnly).toBe(true);
      expect(mode.source).toBe('startup');
      expect(mode.timestamp).toBeInstanceOf(Date);
    });

    test('initializes with write mode when specified', () => {
      initializeModeManager(false);
      const manager = getModeManager();
      const mode = manager.getCurrentMode();

      expect(mode.readOnly).toBe(false);
      expect(mode.source).toBe('startup');
    });

    test('throws error when accessing manager before initialization', () => {
      // Reset the global instance properly
      resetModeManager();

      expect(() => getModeManager()).toThrow('Mode manager not initialized');
    });
  });

  describe('mode toggling', () => {
    beforeEach(() => {
      initializeModeManager(true); // Start in read-only mode
    });

    test('toggles from read-only to write mode', () => {
      const manager = getModeManager();
      const result = manager.toggleReadOnlyMode();

      expect(result.success).toBe(true);
      expect(result.previousMode.readOnly).toBe(true);
      expect(result.newMode.readOnly).toBe(false);
      expect(result.newMode.source).toBe('toggle');
      expect(result.message).toContain('read-only to write');
    });

    test('toggles from write mode to read-only', () => {
      const manager = getModeManager();

      // First toggle to write mode
      manager.toggleReadOnlyMode();

      // Then toggle back to read-only
      const result = manager.toggleReadOnlyMode();

      expect(result.success).toBe(true);
      expect(result.previousMode.readOnly).toBe(false);
      expect(result.newMode.readOnly).toBe(true);
      expect(result.message).toContain('write to read-only');
    });

    test('provides Claude CLI specific messaging when toggling to write mode', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const manager = getModeManager();
      const result = manager.toggleReadOnlyMode();

      expect(result.claudeCLIMessage).toContain(
        '🔓 Claude CLI: Switched to write mode'
      );
      expect(result.warnings).toContain(
        'Write mode allows database modifications'
      );
    });

    test('provides Claude CLI specific messaging when toggling to read-only mode', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(false, clientContext);

      const manager = getModeManager();
      const result = manager.toggleReadOnlyMode();

      expect(result.claudeCLIMessage).toContain(
        '🔒 Claude CLI: Switched to read-only mode'
      );
    });
  });

  describe('explicit mode setting', () => {
    beforeEach(() => {
      initializeModeManager(true);
    });

    test('sets read-only mode explicitly', () => {
      const manager = getModeManager();
      const result = manager.setReadOnlyMode(true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('already in read-only mode');
    });

    test('sets write mode explicitly with warnings', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const manager = getModeManager();
      const result = manager.setReadOnlyMode(false);

      expect(result.success).toBe(true);
      expect(result.newMode.readOnly).toBe(false);
      expect(result.claudeCLIMessage).toContain(
        '🔓 Claude CLI: Write mode enabled'
      );
      expect(result.warnings).toContain(
        'Write mode allows potentially destructive operations'
      );
    });

    test('handles no-change scenario', () => {
      const manager = getModeManager();
      const result = manager.setReadOnlyMode(true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('already in read-only mode');
      expect(result.previousMode).toEqual(result.newMode);
    });
  });

  describe('mode change validation', () => {
    beforeEach(() => {
      initializeModeManager(true);
    });

    test('validates switching to write mode requires confirmation', () => {
      const manager = getModeManager();
      const validation = manager.validateModeChange(false);

      expect(validation.canChange).toBe(true);
      expect(validation.confirmationRequired).toBe(true);
      expect(validation.reason).toContain('requires confirmation');
    });

    test('validates switching to read-only mode is safe', () => {
      initializeModeManager(false); // Start in write mode
      const manager = getModeManager();
      const validation = manager.validateModeChange(true);

      expect(validation.canChange).toBe(true);
      expect(validation.confirmationRequired).toBeUndefined();
      expect(validation.reason).toContain('safe and requires no confirmation');
    });

    test('provides Claude CLI specific prompts', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const manager = getModeManager();
      const validation = manager.validateModeChange(false);

      expect(validation.claudeCLIPrompt).toContain(
        'Claude CLI: Confirm switch to write mode'
      );
    });
  });

  describe('status and security information', () => {
    test('provides Claude CLI status message for read-only mode', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const manager = getModeManager();
      const status = manager.getClaudeCLIStatusMessage();

      expect(status).toContain(
        '🔒 Claude CLI Status: Currently in read-only mode'
      );
      expect(status).toContain('Database queries allowed');
      expect(status).toContain('Database modifications blocked');
    });

    test('provides Claude CLI status message for write mode', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(false, clientContext);

      const manager = getModeManager();
      const status = manager.getClaudeCLIStatusMessage();

      expect(status).toContain('🔓 Claude CLI Status: Currently in write mode');
      expect(status).toContain('Database modifications allowed');
      expect(status).toContain('⚠️  Use with caution!');
    });

    test('provides security information for read-only mode', () => {
      initializeModeManager(true);
      const manager = getModeManager();
      const securityInfo = manager.getSecurityInfo();

      expect(securityInfo.currentMode).toBe('read-only');
      expect(securityInfo.riskLevel).toBe('low');
      expect(securityInfo.recommendations).toContain(
        'Read-only mode is safe for production environments'
      );
    });

    test('provides security information for write mode', () => {
      initializeModeManager(false);
      const manager = getModeManager();
      const securityInfo = manager.getSecurityInfo();

      expect(securityInfo.currentMode).toBe('write');
      expect(securityInfo.riskLevel).toBe('high');
      expect(securityInfo.recommendations).toContain(
        'Write mode allows destructive operations'
      );
    });

    test('includes Claude CLI specific advice in security info', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(false, clientContext);

      const manager = getModeManager();
      const securityInfo = manager.getSecurityInfo();

      expect(securityInfo.claudeCLIAdvice).toContain(
        'Claude CLI: Write mode should be used carefully'
      );
    });
  });

  describe('convenience functions', () => {
    test('toggleReadOnlyModeForClaudeCLI function works', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const result = toggleReadOnlyModeForClaudeCLI();

      expect(result.success).toBe(true);
      expect(result.newMode.readOnly).toBe(false);
    });

    test('getCurrentModeStatus function works', () => {
      initializeModeManager(true);

      const status = getCurrentModeStatus();

      expect(status.readOnly).toBe(true);
      expect(status.source).toBe('startup');
    });

    test('getClaudeCLIStatusDisplay function works', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const display = getClaudeCLIStatusDisplay();

      expect(display).toContain('🔒 Claude CLI Status');
    });

    test('validateModeChangeWithClaudeCLI function works', () => {
      const clientContext: ClientContext = { isClaudeCLI: true };
      initializeModeManager(true, clientContext);

      const validation = validateModeChangeWithClaudeCLI(false);

      expect(validation.canChange).toBe(true);
      expect(validation.confirmationRequired).toBe(true);
    });
  });
});
