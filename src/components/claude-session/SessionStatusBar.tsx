import { clsx } from 'clsx';
import { DollarSign, Clock, Zap } from 'lucide-react';
import type { SessionStatus } from '../../hooks/useClaudeStream';
import type { CostInfo } from '../../hooks/useClaudeStream';

interface SessionStatusBarProps {
  status: SessionStatus;
  cost: CostInfo;
  model?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

export function SessionStatusBar({ status, cost, model }: SessionStatusBarProps) {
  return (
    <div className="session-status-bar">
      {/* Status dot + label */}
      <div className="session-status-bar__item">
        <span className={clsx('session-status-bar__dot', `session-status-bar__dot--${status}`)} />
        <span>{status}</span>
      </div>

      {/* Model */}
      {model && (
        <div className="session-status-bar__item">
          <Zap className="session-status-bar__icon" />
          <span>{model}</span>
        </div>
      )}

      <span className="session-status-bar__spacer" />

      {/* Tokens */}
      {(cost.inputTokens > 0 || cost.outputTokens > 0) && (
        <div className="session-status-bar__item">
          <span>{formatTokens(cost.inputTokens)} in / {formatTokens(cost.outputTokens)} out</span>
        </div>
      )}

      {/* Duration */}
      {cost.durationMs > 0 && (
        <div className="session-status-bar__item">
          <Clock className="session-status-bar__icon" />
          <span>{formatDuration(cost.durationMs)}</span>
        </div>
      )}

      {/* Cost */}
      {cost.totalCostUsd > 0 && (
        <div className="session-status-bar__item">
          <DollarSign className="session-status-bar__icon" />
          <span className="session-status-bar__cost">{formatCost(cost.totalCostUsd)}</span>
        </div>
      )}
    </div>
  );
}
