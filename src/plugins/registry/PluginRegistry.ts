/**
 * Plugin Registry
 *
 * Central registry for managing agent plugins.
 * Handles registration, activation, and plugin lifecycle.
 */

import type {
  AgentPlugin,
  AgentPluginManifest,
  PluginRegistration,
  PluginDiscoveryResult,
} from '../types/plugin';

// ==================== Plugin Registry ====================

class PluginRegistry {
  private plugins: Map<string, PluginRegistration> = new Map();
  private activePluginId: string | null = null;
  private listeners: Set<() => void> = new Set();

  // ==================== Registration ====================

  /**
   * Register a plugin
   */
  async register(plugin: AgentPlugin): Promise<void> {
    const id = plugin.manifest.id;

    if (this.plugins.has(id)) {
      console.warn(`[PluginRegistry] Plugin '${id}' already registered, replacing...`);
    }

    // Check if CLI is installed
    let isInstalled = false;
    try {
      isInstalled = await plugin.validateInstallation();
    } catch (error) {
      console.warn(`[PluginRegistry] Failed to validate '${id}' installation:`, error);
    }

    // Call onLoad hook if provided
    if (plugin.onLoad) {
      try {
        await plugin.onLoad();
      } catch (error) {
        console.error(`[PluginRegistry] Plugin '${id}' onLoad failed:`, error);
      }
    }

    const registration: PluginRegistration = {
      plugin,
      isActive: false,
      isInstalled,
      loadedAt: Date.now(),
    };

    this.plugins.set(id, registration);
    console.log(`[PluginRegistry] Registered plugin '${id}' (installed: ${isInstalled})`);

    // Auto-activate first plugin if none active
    if (this.activePluginId === null && isInstalled) {
      this.setActivePlugin(id);
    }

    this.notifyListeners();
  }

  /**
   * Unregister a plugin
   */
  async unregister(pluginId: string): Promise<void> {
    const registration = this.plugins.get(pluginId);

    if (!registration) {
      console.warn(`[PluginRegistry] Plugin '${pluginId}' not found`);
      return;
    }

    // Deactivate if active
    if (this.activePluginId === pluginId) {
      await this.deactivatePlugin(pluginId);
      this.activePluginId = null;
    }

    // Call onUnload hook if provided
    if (registration.plugin.onUnload) {
      try {
        await registration.plugin.onUnload();
      } catch (error) {
        console.error(`[PluginRegistry] Plugin '${pluginId}' onUnload failed:`, error);
      }
    }

    this.plugins.delete(pluginId);
    console.log(`[PluginRegistry] Unregistered plugin '${pluginId}'`);

    this.notifyListeners();
  }

  // ==================== Getters ====================

  /**
   * Get a plugin by ID
   */
  getPlugin(id: string): AgentPlugin | undefined {
    return this.plugins.get(id)?.plugin;
  }

  /**
   * Get plugin registration info
   */
  getRegistration(id: string): PluginRegistration | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values()).map(r => r.plugin);
  }

  /**
   * Get all installed plugins (CLI available)
   */
  getInstalledPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values())
      .filter(r => r.isInstalled)
      .map(r => r.plugin);
  }

  /**
   * Get the currently active plugin
   */
  getActivePlugin(): AgentPlugin | null {
    if (!this.activePluginId) return null;
    return this.plugins.get(this.activePluginId)?.plugin ?? null;
  }

  /**
   * Get active plugin ID
   */
  getActivePluginId(): string | null {
    return this.activePluginId;
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(id: string): boolean {
    return this.plugins.has(id);
  }

  // ==================== Activation ====================

  /**
   * Set the active plugin
   */
  setActivePlugin(id: string): void {
    const registration = this.plugins.get(id);

    if (!registration) {
      console.warn(`[PluginRegistry] Cannot activate unknown plugin '${id}'`);
      return;
    }

    if (!registration.isInstalled) {
      console.warn(`[PluginRegistry] Cannot activate plugin '${id}' - CLI not installed`);
      return;
    }

    // Deactivate current
    if (this.activePluginId && this.activePluginId !== id) {
      this.deactivatePlugin(this.activePluginId);
    }

    // Activate new
    this.activePluginId = id;
    registration.isActive = true;

    if (registration.plugin.onActivate) {
      try {
        registration.plugin.onActivate();
      } catch (error) {
        console.error(`[PluginRegistry] Plugin '${id}' onActivate failed:`, error);
      }
    }

    console.log(`[PluginRegistry] Activated plugin '${id}'`);
    this.notifyListeners();
  }

  /**
   * Deactivate a plugin
   */
  private deactivatePlugin(id: string): void {
    const registration = this.plugins.get(id);

    if (!registration) return;

    registration.isActive = false;

    if (registration.plugin.onDeactivate) {
      try {
        registration.plugin.onDeactivate();
      } catch (error) {
        console.error(`[PluginRegistry] Plugin '${id}' onDeactivate failed:`, error);
      }
    }

    console.log(`[PluginRegistry] Deactivated plugin '${id}'`);
  }

  // ==================== Discovery ====================

  /**
   * Discover plugins from filesystem
   * TODO: Implement plugin discovery from ~/.agentcockpit/plugins/ and project/.agentcockpit/plugins/
   */
  async discoverPlugins(): Promise<PluginDiscoveryResult> {
    // For now, return empty - plugins are registered programmatically
    // Future: scan directories for manifest.json files
    return {
      manifests: [],
      errors: [],
    };
  }

  /**
   * Refresh installation status for all plugins
   */
  async refreshInstallationStatus(): Promise<void> {
    for (const [id, registration] of this.plugins) {
      try {
        registration.isInstalled = await registration.plugin.validateInstallation();
      } catch {
        registration.isInstalled = false;
      }
      console.log(`[PluginRegistry] Plugin '${id}' installed: ${registration.isInstalled}`);
    }
    this.notifyListeners();
  }

  // ==================== Listeners ====================

  /**
   * Subscribe to registry changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('[PluginRegistry] Listener error:', error);
      }
    });
  }

  // ==================== Utilities ====================

  /**
   * Get manifest for a plugin
   */
  getManifest(id: string): AgentPluginManifest | undefined {
    return this.plugins.get(id)?.plugin.manifest;
  }

  /**
   * Get all manifests
   */
  getAllManifests(): AgentPluginManifest[] {
    return Array.from(this.plugins.values()).map(r => r.plugin.manifest);
  }

  /**
   * Clear all plugins
   */
  async clear(): Promise<void> {
    for (const id of this.plugins.keys()) {
      await this.unregister(id);
    }
    this.activePluginId = null;
  }
}

// ==================== Singleton Export ====================

export const pluginRegistry = new PluginRegistry();
