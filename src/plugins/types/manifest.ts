// ==================== Manifest Types (Declarative) ====================

/**
 * Plugin manifest - declarative configuration loaded from JSON
 */
export interface AgentPluginManifest {
  /** Unique identifier (e.g., 'claude', 'gemini') */
  id: string;

  /** Display name (e.g., 'Claude Code') */
  name: string;

  /** Semantic version */
  version: string;

  /** Short description */
  description: string;

  /** Author or organization */
  author: string;

  // ==================== Visual ====================

  /** Path to icon (SVG/PNG) relative to plugin root, or URL */
  icon: string;

  /** Primary brand color (hex) */
  color: string;

  // ==================== CLI ====================

  cli: {
    /** CLI command name (e.g., 'claude', 'gemini') */
    command: string;

    /** Command to check if CLI is installed (e.g., 'which claude') */
    installCheck: string;

    /** Optional: URL to installation instructions */
    installUrl?: string;
  };

  // ==================== Configuration Paths ====================

  /** Paths where this agent stores configuration */
  configPaths?: {
    /** Desktop app config (e.g., '~/Library/Application Support/Claude/') */
    desktop?: string;

    /** User-level config (e.g., '~/.claude.json') */
    user?: string;

    /** Project-level config directory (e.g., '.claude/') */
    project?: string;
  };

  // ==================== Quick Actions ====================

  /** Quick actions available for this agent */
  quickActions?: QuickActionConfig[];

  // ==================== UI Components ====================

  /** Which UI components this plugin provides */
  components: {
    /** Whether plugin has a launcher component */
    launcher?: boolean;

    /** Whether plugin has an MCP/tool panel */
    mcpPanel?: boolean;

    /** Additional custom panel names */
    customPanels?: string[];
  };

  // ==================== Models ====================

  /** Available models for this agent */
  models?: ModelConfig[];
}

/**
 * Quick action configuration
 */
export interface QuickActionConfig {
  /** Unique ID within plugin */
  id: string;

  /** Display label */
  label: string;

  /** Lucide icon name (e.g., 'Brain', 'Minimize2') */
  icon: string;

  /** Command to execute (string or function returning string) */
  command: string;

  /** Execution type determines how command is sent */
  type: 'command' | 'action' | 'multiline' | 'control';

  /** Optional keyboard shortcut (e.g., 'Ctrl+U') */
  shortcut?: string;

  /** Optional tooltip */
  tooltip?: string;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model ID (e.g., 'haiku', 'sonnet', 'opus') */
  id: string;

  /** Display name */
  name: string;

  /** Optional description */
  description?: string;

  /** Whether this is the default model */
  default?: boolean;
}
