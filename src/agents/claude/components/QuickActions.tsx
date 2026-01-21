/**
 * Claude Quick Actions
 *
 * Quick action buttons for Claude CLI.
 * Part of the Claude agent plugin.
 */

import { useCallback } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import type { QuickActionsProps } from '../../../plugins/types/plugin';
import { executeAction } from '../../../core/utils/terminalCommands';

export function ClaudeQuickActions({
  onWriteToTerminal,
  disabled,
}: QuickActionsProps) {
  // Handle standard action (text + delay + carriage return)
  const handleAction = useCallback(async (action: string) => {
    await executeAction(onWriteToTerminal, action);
  }, [onWriteToTerminal]);

  return (
    <div className="panel-section">
      <div className="box-title">Quick Actions</div>
      <div className="quick-actions-grid">
        <button
          className="action-card"
          onClick={() => handleAction('/compact')}
          disabled={disabled}
          title="Compact context"
        >
          <Archive size={18} style={{ color: 'var(--accent)' }} />
          <span>Compact</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/clear')}
          disabled={disabled}
          title="Clear conversation"
        >
          <RotateCcw size={18} style={{ color: 'var(--text-muted)' }} />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
}
