/**
 * Agent Plugin Type Definitions
 *
 * Defines the contract for agent plugins (Claude, Gemini, etc.)
 * Plugins declare their capabilities via manifest and provide runtime components.
 */

import type { ComponentType } from 'react';

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

// ==================== Runtime Types ====================

/**
 * Full agent plugin with runtime components
 */
export interface AgentPlugin {
  /** Declarative manifest */
  manifest: AgentPluginManifest;

  // ==================== React Components ====================

  /** Launcher component (model selection, start button) */
  Launcher?: ComponentType<LauncherProps>;

  /** MCP/Tool panel component */
  McpPanel?: ComponentType<McpPanelProps>;

  /** Quick actions component */
  QuickActions?: ComponentType<QuickActionsProps>;

  /** Custom panels by name */
  CustomPanels?: Record<string, ComponentType<CustomPanelProps>>;

  // ==================== Services ====================

  /**
   * Build CLI command with options
   */
  buildCommand: (options: BuildCommandOptions) => string;

  /**
   * Check if CLI is installed
   */
  validateInstallation: () => Promise<boolean>;

  // ==================== Lifecycle Hooks ====================

  /** Called when plugin becomes active */
  onActivate?: () => void;

  /** Called when plugin is deactivated */
  onDeactivate?: () => void;

  /** Called when plugin is first loaded */
  onLoad?: () => Promise<void>;

  /** Called when plugin is unloaded */
  onUnload?: () => Promise<void>;
}

// ==================== Component Props ====================

/**
 * Props for Launcher component
 */
export interface LauncherProps {
  /** Current project path */
  projectPath: string | null;

  /** Selected session (if any) */
  session: SessionInfo | null;

  /** Whether there's an active terminal */
  hasActiveTerminal: boolean;

  /** MCPs to inject before launch */
  mcpsToInject: McpServerInfo[];

  /** MCP names to remove before launch */
  mcpsToRemove: string[];

  /** Callback to execute launch command */
  onLaunch: (command: string) => void;

  /** Direct terminal write access */
  onWriteToTerminal: (data: string) => Promise<void>;

  /** Callback to ensure session exists before launch */
  ensureSession: () => Promise<SessionInfo | null>;
}

/**
 * Props for MCP Panel component
 */
export interface McpPanelProps {
  /** Current project path */
  projectPath: string | null;

  /** Callback when MCP selection changes (new API) */
  onMcpsChange?: (toInject: McpServerInfo[], toRemove: string[]) => void;

  // Legacy props for backwards compatibility
  /** @deprecated Use onMcpsChange instead */
  selectedServers?: string[];

  /** @deprecated Use onMcpsChange instead */
  onSelectionChange?: (servers: string[]) => void;

  /** @deprecated Use onMcpsChange instead */
  onMcpsForInjection?: (mcps: McpServerInfo[]) => void;

  /** @deprecated Use onMcpsChange instead */
  onMcpsForRemoval?: (names: string[]) => void;
}

/**
 * Props for Quick Actions component
 */
export interface QuickActionsProps {
  /** Direct terminal write access */
  onWriteToTerminal: (data: string) => Promise<void>;

  /** Whether actions should be disabled */
  disabled: boolean;
}

/**
 * Props for custom panels
 */
export interface CustomPanelProps {
  /** Current project path */
  projectPath: string | null;

  /** Direct terminal write access */
  onWriteToTerminal: (data: string) => Promise<void>;
}

// ==================== Service Types ====================

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
}

// ==================== Shared Types ====================

/**
 * Session information (agent-agnostic)
 */
export interface SessionInfo {
  /** Unique session ID */
  id: string;

  /** Display name */
  name: string;

  /** Creation timestamp */
  createdAt: number;

  /** Last used timestamp */
  lastUsed: number;

  /** Model used in this session */
  model?: string;

  /** Associated terminal ID */
  terminalId?: string;

  /** Whether session existed before current app session */
  wasPreExisting?: boolean;
}

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

// ==================== Plugin Registry Types ====================

/**
 * Plugin registration info
 */
export interface PluginRegistration {
  /** Plugin instance */
  plugin: AgentPlugin;

  /** Whether plugin is currently active */
  isActive: boolean;

  /** Whether CLI is installed */
  isInstalled: boolean;

  /** Load timestamp */
  loadedAt: number;
}

/**
 * Plugin discovery result
 */
export interface PluginDiscoveryResult {
  /** Discovered manifests */
  manifests: AgentPluginManifest[];

  /** Errors during discovery */
  errors: string[];
}
