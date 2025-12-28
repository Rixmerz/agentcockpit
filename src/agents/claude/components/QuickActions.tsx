/**
 * Claude Quick Actions
 *
 * Quick action buttons for Claude CLI.
 * Part of the Claude agent plugin.
 */

import { useCallback } from 'react';
import { Zap, Archive } from 'lucide-react';
import type { QuickActionsProps } from '../../../plugins/types/plugin';
import {
  executeAction,
  executeMultiline,
} from '../../../core/utils/terminalCommands';

export function ClaudeQuickActions({
  onWriteToTerminal,
  disabled,
}: QuickActionsProps) {
  // Handle standard action (text + delay + carriage return)
  const handleAction = useCallback(async (action: string) => {
    await executeAction(onWriteToTerminal, action);
  }, [onWriteToTerminal]);

  // Handle ultrathink (multiline pattern)
  const handleUltrathink = useCallback(async () => {
    await executeMultiline(onWriteToTerminal, ['ultrathink']);
  }, [onWriteToTerminal]);

  return (
    <div className="panel-section">
      <div className="box-title">Acciones Rapidas</div>
      <div className="quick-actions-grid">
        <button
          className="action-card"
          onClick={handleUltrathink}
          disabled={disabled}
          title="Enviar 'ultrathink'"
        >
          <Zap size={18} style={{ color: 'var(--warning)' }} />
          <span>Ultrathink</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/compact')}
          disabled={disabled}
          title="Compactar contexto"
        >
          <Archive size={18} style={{ color: 'var(--accent)' }} />
          <span>Compact</span>
        </button>
      </div>
    </div>
  );
}
