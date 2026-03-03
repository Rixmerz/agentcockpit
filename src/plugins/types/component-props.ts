import type { SessionInfo } from './session';
import type { McpServerInfo } from './mcp';

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

  /** Whether to skip permissions (controlled by parent) */
  skipPermissions?: boolean;

  /** Callback when skip permissions changes */
  onSkipPermissionsChange?: (value: boolean) => void;
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
