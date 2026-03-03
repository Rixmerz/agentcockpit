/**
 * Agentful Quick Actions
 *
 * One-click buttons for all agentful slash commands and workflow activation.
 */

import { useCallback } from 'react';
import {
  Play,
  BarChart3,
  HelpCircle,
  ShieldCheck,
  FileText,
  Sparkles,
} from 'lucide-react';
import type { QuickActionsProps } from '../../../plugins/types/plugin';
import { executeAction } from '../../../core/utils/terminalCommands';

export function AgentfulQuickActions({
  onWriteToTerminal,
  disabled,
}: QuickActionsProps) {
  const handleAction = useCallback(async (action: string) => {
    await executeAction(onWriteToTerminal, action);
  }, [onWriteToTerminal]);

  return (
    <div className="panel-section">
      <div className="box-title">Agentful</div>
      <div className="quick-actions-grid">
        <button
          className="action-card"
          onClick={() => handleAction('/agentful-start')}
          disabled={disabled}
          title="Start/resume the development loop"
        >
          <Play size={18} style={{ color: 'var(--accent)' }} />
          <span>Start</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/agentful-status')}
          disabled={disabled}
          title="Show completion % and current work"
        >
          <BarChart3 size={18} style={{ color: '#00D4AA' }} />
          <span>Status</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/agentful-decide')}
          disabled={disabled}
          title="Answer pending decisions"
        >
          <HelpCircle size={18} style={{ color: 'var(--warning)' }} />
          <span>Decide</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/agentful-validate')}
          disabled={disabled}
          title="Run 6 quality gates"
        >
          <ShieldCheck size={18} style={{ color: 'var(--success)' }} />
          <span>Validate</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/agentful-product')}
          disabled={disabled}
          title="Analyze and improve product spec"
        >
          <FileText size={18} style={{ color: '#a78bfa' }} />
          <span>Product</span>
        </button>
        <button
          className="action-card"
          onClick={() => handleAction('/agentful-generate')}
          disabled={disabled}
          title="Regenerate agents for tech stack"
        >
          <Sparkles size={18} style={{ color: '#f59e0b' }} />
          <span>Generate</span>
        </button>
      </div>
    </div>
  );
}
