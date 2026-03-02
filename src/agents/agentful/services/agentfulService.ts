/**
 * Agentful Service
 *
 * Command builder for agentful operations.
 * Agentful runs as slash commands within a Claude session,
 * so buildCommand returns the base claude command.
 */

import type { BuildCommandOptions } from '../../../plugins/types/plugin';

export function buildAgentfulCommand(options: BuildCommandOptions): string {
  const parts = ['claude'];

  if (options.sessionId) {
    if (options.resume) {
      parts.push('--resume', options.sessionId);
    } else {
      parts.push('--session-id', options.sessionId);
    }
  }

  if (options.skipPermissions) {
    parts.push('--dangerously-skip-permissions');
  }

  if (options.additionalArgs) {
    parts.push(...options.additionalArgs);
  }

  return parts.join(' ');
}
