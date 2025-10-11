import type { ClientContext } from '../auth.js';

export interface RuntimeMode {
  readOnly: boolean;
  timestamp: Date;
  source: 'startup' | 'toggle' | 'environment';
}

export interface ModeChangeResult {
  success: boolean;
  previousMode: RuntimeMode;
  newMode: RuntimeMode;
  message: string;
  claudeCLIMessage?: string;
  warnings?: string[];
}

class ModeManager {
  private currentMode: RuntimeMode;
  private clientContext?: ClientContext;

  constructor(initialReadOnly: boolean = false, clientContext?: ClientContext) {
    this.currentMode = {
      readOnly: initialReadOnly,
      timestamp: new Date(),
      source: 'startup',
    };
    this.clientContext = clientContext;
  }

  getCurrentMode(): RuntimeMode {
    return { ...this.currentMode };
  }

  isReadOnly(): boolean {
    return this.currentMode.readOnly;
  }

  toggleReadOnlyMode(): ModeChangeResult {
    const previousMode = { ...this.currentMode };
    const newReadOnlyState = !this.currentMode.readOnly;

    this.currentMode = {
      readOnly: newReadOnlyState,
      timestamp: new Date(),
      source: 'toggle',
    };

    const result: ModeChangeResult = {
      success: true,
      previousMode,
      newMode: { ...this.currentMode },
      message: `Mode changed from ${previousMode.readOnly ? 'read-only' : 'write'} to ${newReadOnlyState ? 'read-only' : 'write'}`,
    };

    // Add Claude CLI specific messaging
    if (this.clientContext?.isClaudeCLI) {
      if (newReadOnlyState) {
        result.claudeCLIMessage =
          '🔒 Claude CLI: Switched to read-only mode. All database operations are now restricted to queries only.';
      } else {
        result.claudeCLIMessage =
          '🔓 Claude CLI: Switched to write mode. Database modifications are now allowed. Use with caution!';
        result.warnings = [
          'Write mode allows database modifications',
          'Always backup important data before making changes',
          'Consider testing changes in a development environment first',
        ];
      }
    }

    return result;
  }

  setReadOnlyMode(
    readOnly: boolean,
    source: 'startup' | 'toggle' | 'environment' = 'toggle'
  ): ModeChangeResult {
    const previousMode = { ...this.currentMode };

    if (previousMode.readOnly === readOnly) {
      return {
        success: true,
        previousMode,
        newMode: previousMode,
        message: `Mode unchanged - already in ${readOnly ? 'read-only' : 'write'} mode`,
        claudeCLIMessage: this.clientContext?.isClaudeCLI
          ? `✅ Claude CLI: Already in ${readOnly ? 'read-only' : 'write'} mode`
          : undefined,
      };
    }

    this.currentMode = {
      readOnly,
      timestamp: new Date(),
      source,
    };

    const result: ModeChangeResult = {
      success: true,
      previousMode,
      newMode: { ...this.currentMode },
      message: `Mode set to ${readOnly ? 'read-only' : 'write'}`,
    };

    // Add Claude CLI specific messaging
    if (this.clientContext?.isClaudeCLI) {
      if (readOnly) {
        result.claudeCLIMessage =
          '🔒 Claude CLI: Read-only mode enabled. Database operations are restricted to queries.';
      } else {
        result.claudeCLIMessage =
          '🔓 Claude CLI: Write mode enabled. Database modifications are allowed.';
        result.warnings = [
          'Write mode allows potentially destructive operations',
          'Use caution when modifying database schemas or data',
          'Consider using a development environment for testing',
        ];
      }
    }

    return result;
  }

  validateModeChange(targetReadOnly: boolean): {
    canChange: boolean;
    reason?: string;
    confirmationRequired?: boolean;
    claudeCLIPrompt?: string;
  } {
    // If switching to write mode, require confirmation
    if (!targetReadOnly && this.currentMode.readOnly) {
      return {
        canChange: true,
        confirmationRequired: true,
        reason:
          'Switching to write mode requires confirmation due to potential for destructive operations',
        claudeCLIPrompt: this.clientContext?.isClaudeCLI
          ? 'Claude CLI: Confirm switch to write mode? This will allow database modifications. Type "yes" to confirm.'
          : undefined,
      };
    }

    // Switching to read-only is always safe
    if (targetReadOnly && !this.currentMode.readOnly) {
      return {
        canChange: true,
        reason:
          'Switching to read-only mode is safe and requires no confirmation',
      };
    }

    // No change needed
    return {
      canChange: true,
      reason: `Already in ${targetReadOnly ? 'read-only' : 'write'} mode`,
    };
  }

  getClaudeCLIStatusMessage(): string {
    const mode = this.currentMode.readOnly ? 'read-only' : 'write';
    const icon = this.currentMode.readOnly ? '🔒' : '🔓';
    const lastChanged = this.currentMode.timestamp.toLocaleTimeString();

    let message = `${icon} Claude CLI Status: Currently in ${mode} mode (since ${lastChanged})`;

    if (this.currentMode.readOnly) {
      message +=
        '\n• Database queries allowed\n• Database modifications blocked\n• Safe for production use';
    } else {
      message +=
        '\n• Database queries allowed\n• Database modifications allowed\n• ⚠️  Use with caution!';
    }

    return message;
  }

  getSecurityInfo(): {
    currentMode: string;
    riskLevel: 'low' | 'medium' | 'high';
    recommendations: string[];
    claudeCLIAdvice?: string[];
  } {
    const riskLevel = this.currentMode.readOnly ? 'low' : 'high';
    const recommendations: string[] = [];
    const claudeCLIAdvice: string[] = [];

    if (this.currentMode.readOnly) {
      recommendations.push(
        'Read-only mode is safe for production environments'
      );
      recommendations.push('All database operations are limited to queries');
      claudeCLIAdvice.push(
        'Claude CLI: Read-only mode is recommended for safe exploration'
      );
    } else {
      recommendations.push('Write mode allows destructive operations');
      recommendations.push('Always backup data before making modifications');
      recommendations.push('Test changes in development environment first');
      recommendations.push(
        'Consider switching back to read-only when not needed'
      );

      claudeCLIAdvice.push('Claude CLI: Write mode should be used carefully');
      claudeCLIAdvice.push(
        'Consider toggling back to read-only when modifications are complete'
      );
    }

    return {
      currentMode: this.currentMode.readOnly ? 'read-only' : 'write',
      riskLevel,
      recommendations,
      claudeCLIAdvice: this.clientContext?.isClaudeCLI
        ? claudeCLIAdvice
        : undefined,
    };
  }
}

// Global mode manager instance
export let modeManagerInstance: ModeManager | null = null;

export function initializeModeManager(
  initialReadOnly: boolean,
  clientContext?: ClientContext
): void {
  modeManagerInstance = new ModeManager(initialReadOnly, clientContext);
}

export function getModeManager(): ModeManager {
  if (!modeManagerInstance) {
    throw new Error(
      'Mode manager not initialized. Call initializeModeManager() first.'
    );
  }
  return modeManagerInstance;
}

export function resetModeManager(): void {
  modeManagerInstance = null;
}

// Convenience functions for common operations
export function toggleReadOnlyModeForClaudeCLI(): ModeChangeResult {
  const manager = getModeManager();
  const result = manager.toggleReadOnlyMode();

  // Log Claude CLI specific messages
  if (result.claudeCLIMessage) {
    console.log(result.claudeCLIMessage);
  }

  if (result.warnings) {
    result.warnings.forEach((warning) => console.warn(`⚠️  ${warning}`));
  }

  return result;
}

export function getCurrentModeStatus(): RuntimeMode {
  const manager = getModeManager();
  return manager.getCurrentMode();
}

export function getClaudeCLIStatusDisplay(): string {
  const manager = getModeManager();
  return manager.getClaudeCLIStatusMessage();
}

export function validateModeChangeWithClaudeCLI(targetReadOnly: boolean): {
  canChange: boolean;
  reason?: string;
  confirmationRequired?: boolean;
  claudeCLIPrompt?: string;
} {
  const manager = getModeManager();
  return manager.validateModeChange(targetReadOnly);
}
