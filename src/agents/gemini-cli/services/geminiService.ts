/**
 * Gemini Service
 *
 * Service for interacting with gemini CLI.
 * Part of the gemini-cli plugin.
 */

import type { BuildCommandOptions } from '../../../plugins/types/plugin';

/**
 * Build gemini CLI command
 */
export function buildGeminiCommand(options: BuildCommandOptions): string {
  const args: string[] = ['gemini'];

  // Additional args
  if (options.additionalArgs) {
    args.push(...options.additionalArgs);
  }

  return args.join(' ');
}
