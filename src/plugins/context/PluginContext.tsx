/**
 * Plugin Context
 *
 * React context for accessing plugin state and registry.
 * Provides hooks for components to interact with plugins.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type FC,
} from 'react';
import { pluginRegistry } from '../registry/PluginRegistry';
import type { AgentPlugin, AgentPluginManifest } from '../types/plugin';

// ==================== Context Types ====================

interface PluginContextValue {
  /** All registered plugins */
  plugins: AgentPlugin[];

  /** Only installed plugins (CLI available) */
  installedPlugins: AgentPlugin[];

  /** Currently active plugin */
  activePlugin: AgentPlugin | null;

  /** Active plugin ID */
  activePluginId: string | null;

  /** Set the active plugin by ID */
  setActivePlugin: (id: string) => void;

  /** Whether plugins are loading */
  isLoading: boolean;

  /** Register a new plugin */
  registerPlugin: (plugin: AgentPlugin) => Promise<void>;

  /** Unregister a plugin */
  unregisterPlugin: (id: string) => Promise<void>;

  /** Refresh installation status */
  refreshInstallation: () => Promise<void>;

  /** Get manifest for a plugin */
  getManifest: (id: string) => AgentPluginManifest | undefined;
}

// ==================== Context Creation ====================

const PluginContext = createContext<PluginContextValue | null>(null);

// ==================== Provider Component ====================

interface PluginProviderProps {
  children: ReactNode;
  /** Optional: Plugins to register on mount */
  initialPlugins?: AgentPlugin[];
}

export const PluginProvider: FC<PluginProviderProps> = ({
  children,
  initialPlugins = [],
}) => {
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<AgentPlugin[]>([]);
  const [activePlugin, setActivePluginState] = useState<AgentPlugin | null>(null);
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sync state from registry
  const syncFromRegistry = useCallback(() => {
    setPlugins(pluginRegistry.getAllPlugins());
    setInstalledPlugins(pluginRegistry.getInstalledPlugins());
    setActivePluginState(pluginRegistry.getActivePlugin());
    setActivePluginId(pluginRegistry.getActivePluginId());
  }, []);

  // Subscribe to registry changes
  useEffect(() => {
    const unsubscribe = pluginRegistry.subscribe(syncFromRegistry);
    return unsubscribe;
  }, [syncFromRegistry]);

  // Register initial plugins on mount
  useEffect(() => {
    const initPlugins = async () => {
      setIsLoading(true);

      for (const plugin of initialPlugins) {
        try {
          await pluginRegistry.register(plugin);
        } catch (error) {
          console.error(`[PluginProvider] Failed to register '${plugin.manifest.id}':`, error);
        }
      }

      syncFromRegistry();
      setIsLoading(false);
    };

    initPlugins();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ==================== Actions ====================

  const setActivePlugin = useCallback((id: string) => {
    pluginRegistry.setActivePlugin(id);
  }, []);

  const registerPlugin = useCallback(async (plugin: AgentPlugin) => {
    await pluginRegistry.register(plugin);
  }, []);

  const unregisterPlugin = useCallback(async (id: string) => {
    await pluginRegistry.unregister(id);
  }, []);

  const refreshInstallation = useCallback(async () => {
    setIsLoading(true);
    await pluginRegistry.refreshInstallationStatus();
    syncFromRegistry();
    setIsLoading(false);
  }, [syncFromRegistry]);

  const getManifest = useCallback((id: string) => {
    return pluginRegistry.getManifest(id);
  }, []);

  // ==================== Context Value ====================

  const value: PluginContextValue = {
    plugins,
    installedPlugins,
    activePlugin,
    activePluginId,
    setActivePlugin,
    isLoading,
    registerPlugin,
    unregisterPlugin,
    refreshInstallation,
    getManifest,
  };

  return (
    <PluginContext.Provider value={value}>
      {children}
    </PluginContext.Provider>
  );
};

// ==================== Hooks ====================

/**
 * Hook to access full plugin context
 */
export function usePlugins(): PluginContextValue {
  const context = useContext(PluginContext);

  if (!context) {
    throw new Error('usePlugins must be used within a PluginProvider');
  }

  return context;
}

/**
 * Hook to get only the active plugin
 */
export function useActivePlugin(): AgentPlugin | null {
  const { activePlugin } = usePlugins();
  return activePlugin;
}

/**
 * Hook to get a specific plugin by ID
 */
export function usePlugin(id: string): AgentPlugin | undefined {
  const { plugins } = usePlugins();
  return plugins.find(p => p.manifest.id === id);
}

/**
 * Hook to check if a specific CLI is installed
 */
export function usePluginInstalled(id: string): boolean {
  const { installedPlugins } = usePlugins();
  return installedPlugins.some(p => p.manifest.id === id);
}
