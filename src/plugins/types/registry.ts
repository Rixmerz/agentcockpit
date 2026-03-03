import type { AgentPlugin } from './plugin-contract';
import type { AgentPluginManifest } from './manifest';

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
