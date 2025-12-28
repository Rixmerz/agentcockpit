/**
 * Terminal Command Utilities
 *
 * Reusable utilities for sending commands to PTY terminals.
 * Used by all agent plugins (Claude, Gemini, etc.)
 */

// ==================== Constants ====================

/** Delay between PTY operations to ensure proper processing */
export const PTY_DELAY = 50;

/** Delay for cleanup operations (process termination, etc.) */
export const CLEANUP_DELAY = 200;

// ==================== Core Utilities ====================

/**
 * Simple delay utility
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a command immediately (adds newline to execute)
 * Use for: shell commands, CLI invocations
 *
 * @example
 * await executeCommand(writer, 'claude --session-id abc123');
 */
export async function executeCommand(
  writer: (data: string) => Promise<void>,
  command: string
): Promise<void> {
  await writer(command + '\n');
}

/**
 * Execute an action with delay pattern (action + delay + carriage return)
 * Use for: slash commands, interactive prompts
 *
 * @example
 * await executeAction(writer, '/compact');
 * await executeAction(writer, '/model sonnet');
 */
export async function executeAction(
  writer: (data: string) => Promise<void>,
  action: string
): Promise<void> {
  await writer(action);
  await delay(PTY_DELAY);
  await writer('\r');
}

/**
 * Execute multiline content (newline + text + delay + carriage return)
 * Use for: commands that need to be appended to pending input
 *
 * @example
 * await executeMultiline(writer, ['ultrathink']);
 */
export async function executeMultiline(
  writer: (data: string) => Promise<void>,
  lines: string[]
): Promise<void> {
  // Add newline to start fresh line in pending input
  await writer('\n');
  await delay(PTY_DELAY);

  // Write each line
  for (const line of lines) {
    await writer(line);
    await delay(PTY_DELAY);
  }

  // Execute
  await writer('\r');
}

/**
 * Send a control character
 * Use for: Ctrl+C (cancel), Ctrl+D (EOF), etc.
 *
 * @example
 * await sendControlChar(writer, '\x03'); // Ctrl+C
 */
export async function sendControlChar(
  writer: (data: string) => Promise<void>,
  char: string
): Promise<void> {
  await writer(char);
}

// ==================== Command Building Utilities ====================

/**
 * Escape JSON string for shell command
 * Handles single quotes by closing string, escaping, reopening
 *
 * @example
 * const escaped = escapeJsonForShell({ key: "value's" });
 * // Use in: `command '${escaped}'`
 */
export function escapeJsonForShell(json: object | string): string {
  const jsonStr = typeof json === 'string' ? json : JSON.stringify(json);
  return jsonStr.replace(/'/g, "'\"'\"'");
}

/**
 * Escape string for writing to config files via echo
 */
export function escapeForConfigFile(content: string): string {
  return content.replace(/'/g, "'\\''");
}

/**
 * Join multiple commands to run sequentially
 * Uses semicolon separator so all commands run regardless of exit status
 *
 * @example
 * const cmd = joinCommandsSequential(['cmd1', 'cmd2', 'cmd3']);
 * // Result: 'cmd1 ; cmd2 ; cmd3'
 */
export function joinCommandsSequential(commands: string[]): string {
  return commands.join(' ; ');
}

/**
 * Wrap command with error suppression and continue-on-error
 * Use for: commands that might fail but shouldn't block execution
 *
 * @example
 * const safe = wrapCommandSafe('claude mcp remove "test"');
 * // Result: 'claude mcp remove "test" 2>/dev/null || true'
 */
export function wrapCommandSafe(cmd: string): string {
  return `${cmd} 2>/dev/null || true`;
}

/**
 * Build a safe command that suppresses errors and continues
 */
export function buildSafeCommand(cmd: string): string {
  return wrapCommandSafe(cmd);
}

// ==================== Command Execution Patterns ====================

/**
 * Execute multiple commands sequentially in terminal
 * Combines all commands with '; ' separator
 *
 * @example
 * await executeCommandSequence(writer, [
 *   'claude mcp remove "old"',
 *   'claude mcp add-json "new" \'{}\'',
 *   'claude --session-id abc'
 * ]);
 */
export async function executeCommandSequence(
  writer: (data: string) => Promise<void>,
  commands: string[]
): Promise<void> {
  const fullCommand = joinCommandsSequential(commands);
  await executeCommand(writer, fullCommand);
}

// ==================== Type Definitions ====================

export type TerminalWriter = (data: string) => Promise<void>;

export interface CommandExecutionOptions {
  /** Whether to suppress errors (2>/dev/null || true) */
  safe?: boolean;
  /** Custom delay between operations */
  delay?: number;
}
