/**
 * Cursor Agent Service
 *
 * Service for interacting with cursor-agent CLI.
 * Part of the cursor-agent plugin.
 */

import type { BuildCommandOptions } from '../../../plugins/types/plugin';

/**
 * Build cursor-agent CLI command
 */
export function buildCursorAgentCommand(options: BuildCommandOptions): string {
  const args: string[] = ['cursor-agent'];

  // Additional args
  if (options.additionalArgs) {
    args.push(...options.additionalArgs);
  }

  return args.join(' ');
}
