/**
 * Options for building CLI command
 */
export interface BuildCommandOptions {
  /** Session ID */
  sessionId?: string;

  /** Whether to resume existing session */
  resume?: boolean;

  /** Model to use */
  model?: string;

  /** Additional CLI arguments */
  additionalArgs?: string[];

  /** Whether to enable MCP from desktop config */
  mcpDesktop?: boolean;

  /** Whether to enable default MCP */
  mcpDefault?: boolean;

  /** Whether to skip permission prompts */
  skipPermissions?: boolean;
}
