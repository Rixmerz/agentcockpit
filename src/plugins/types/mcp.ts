/**
 * MCP server information
 */
export interface McpServerInfo {
  /** Server name */
  name: string;

  /** Server configuration */
  config: McpServerConfig;

  /** Source of this MCP (desktop, code, etc.) */
  source: string;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  /** Command to run (for stdio transport) */
  command?: string;

  /** Command arguments */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** URL (for HTTP transport) */
  url?: string;

  /** Any additional config */
  [key: string]: unknown;
}
