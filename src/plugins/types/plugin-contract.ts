import type { ComponentType } from 'react';
import type { AgentPluginManifest } from './manifest';
import type { LauncherProps, McpPanelProps, QuickActionsProps, CustomPanelProps } from './component-props';
import type { BuildCommandOptions } from './command';

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
