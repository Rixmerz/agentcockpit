import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir, removeDir } from '@tauri-apps/plugin-fs';
import { executeCommand } from './fileSystemService';

export interface IntegrationSource {
  type: 'npm';
  package: string;
  init_command?: string;
}

export interface IntegrationProvides {
  node_type: 'integration-wrapper';
  agents?: string[];
  skills?: string[];
  hooks?: string[];
}

export interface IntegrationManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  source: IntegrationSource;
  provides: IntegrationProvides;
  entry_skill: string;
  exit_condition: string;
  status: 'installed' | 'disabled';
  installed_at: string;
}

export interface MarketplaceConfig {
  hub_dir: string;
  integrations_dir: string;
  installed: string[];
}

export interface AvailableIntegration {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  status: 'available' | 'installed' | 'disabled';
}

const HARDCODED_REGISTRY: Record<string, Omit<IntegrationManifest, 'status' | 'installed_at'>> = {
  agentful: {
    id: 'agentful',
    name: 'Agentful',
    version: '1.0.0',
    description: 'Parallel agent orchestration with protective hooks',
    author: 'itz4blitz',
    source: {
      type: 'npm',
      package: '@itz4blitz/agentful',
      init_command: 'npx @itz4blitz/agentful init'
    },
    provides: {
      node_type: 'integration-wrapper',
      agents: ['orchestrator', 'backend', 'frontend', 'tester', 'reviewer', 'fixer', 'architect', 'product-analyzer'],
      skills: ['agentful-start', 'agentful-status', 'agentful-generate', 'agentful-decide', 'agentful-validate'],
      hooks: ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']
    },
    entry_skill: '/agentful-start',
    exit_condition: 'AGENTFUL_COMPLETE'
  }
};

let cachedHomeDir: string | null = null;
let cachedConfig: MarketplaceConfig | null = null;

async function getHomeDir(): Promise<string> {
  if (cachedHomeDir) return cachedHomeDir;
  const home = await homeDir();
  if (!home) throw new Error('Could not determine home directory');
  cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  return cachedHomeDir;
}

async function getMarketplaceDir(): Promise<string> {
  const home = await getHomeDir();
  return `${home}/.agentcockpit`;
}

async function getIntegrationsDir(): Promise<string> {
  const mktDir = await getMarketplaceDir();
  return `${mktDir}/integrations`;
}

async function getConfigPath(): Promise<string> {
  const mktDir = await getMarketplaceDir();
  return `${mktDir}/config.json`;
}

async function ensureStructure(): Promise<void> {
  try {
    const mktDir = await getMarketplaceDir();
    const intDir = await getIntegrationsDir();
    const cfgPath = await getConfigPath();

    if (!(await exists(mktDir))) {
      await mkdir(mktDir, { recursive: true });
    }
    if (!(await exists(intDir))) {
      await mkdir(intDir, { recursive: true });
    }

    if (!(await exists(cfgPath))) {
      const defaultConfig: MarketplaceConfig = {
        hub_dir: mktDir,
        integrations_dir: intDir,
        installed: []
      };
      await writeTextFile(cfgPath, JSON.stringify(defaultConfig, null, 2));
      cachedConfig = defaultConfig;
    }
  } catch (error) {
    console.error('[Marketplace] Error ensuring structure:', error);
    throw error;
  }
}

async function loadConfig(): Promise<MarketplaceConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    await ensureStructure();
    const cfgPath = await getConfigPath();
    const content = await readTextFile(cfgPath);
    cachedConfig = JSON.parse(content);
    return cachedConfig;
  } catch (error) {
    console.error('[Marketplace] Error loading config:', error);
    throw error;
  }
}

async function saveConfig(config: MarketplaceConfig): Promise<void> {
  try {
    const cfgPath = await getConfigPath();
    await writeTextFile(cfgPath, JSON.stringify(config, null, 2));
    cachedConfig = config;
  } catch (error) {
    console.error('[Marketplace] Error saving config:', error);
    throw error;
  }
}

async function getManifest(integrationId: string): Promise<IntegrationManifest | null> {
  try {
    const intDir = await getIntegrationsDir();
    const manifestPath = `${intDir}/${integrationId}/manifest.json`;
    if (!(await exists(manifestPath))) return null;
    const content = await readTextFile(manifestPath);
    return JSON.parse(content);
  } catch (error) {
    console.error(`[Marketplace] Error reading manifest for ${integrationId}:`, error);
    return null;
  }
}

async function saveManifest(manifest: IntegrationManifest): Promise<void> {
  try {
    const intDir = await getIntegrationsDir();
    const integrationDir = `${intDir}/${manifest.id}`;
    if (!(await exists(integrationDir))) {
      await mkdir(integrationDir, { recursive: true });
    }
    const manifestPath = `${integrationDir}/manifest.json`;
    await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(`[Marketplace] Error saving manifest for ${manifest.id}:`, error);
    throw error;
  }
}

export const marketplaceService = {
  async listAvailable(): Promise<AvailableIntegration[]> {
    try {
      const config = await loadConfig();
      return Object.values(HARDCODED_REGISTRY).map(integration => ({
        id: integration.id,
        name: integration.name,
        version: integration.version,
        description: integration.description,
        author: integration.author,
        status: config.installed.includes(integration.id) ? 'installed' : 'available'
      }));
    } catch (error) {
      console.error('[Marketplace] Error listing available:', error);
      return [];
    }
  },

  async listInstalled(): Promise<IntegrationManifest[]> {
    try {
      const config = await loadConfig();
      const installed: IntegrationManifest[] = [];
      for (const id of config.installed) {
        const manifest = await getManifest(id);
        if (manifest) installed.push(manifest);
      }
      return installed;
    } catch (error) {
      console.error('[Marketplace] Error listing installed:', error);
      return [];
    }
  },

  async getStatus(integrationId: string): Promise<AvailableIntegration | null> {
    try {
      const available = await this.listAvailable();
      return available.find(i => i.id === integrationId) || null;
    } catch (error) {
      console.error(`[Marketplace] Error getting status:`, error);
      return null;
    }
  },

  async install(integrationId: string): Promise<{ success: boolean; message: string }> {
    try {
      const integrationDef = HARDCODED_REGISTRY[integrationId];
      if (!integrationDef) {
        return { success: false, message: `Integration ${integrationId} not found` };
      }

      const manifest: IntegrationManifest = {
        ...integrationDef,
        status: 'installed',
        installed_at: new Date().toISOString()
      };

      await saveManifest(manifest);
      const config = await loadConfig();
      if (!config.installed.includes(integrationId)) {
        config.installed.push(integrationId);
        await saveConfig(config);
      }

      return { success: true, message: `${integrationDef.name} installed successfully` };
    } catch (error) {
      console.error(`[Marketplace] Error installing:`, error);
      return { success: false, message: `Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  async uninstall(integrationId: string): Promise<{ success: boolean; message: string }> {
    try {
      const intDir = await getIntegrationsDir();
      const integrationDir = `${intDir}/${integrationId}`;

      if (await exists(integrationDir)) {
        await removeDir(integrationDir, { recursive: true });
      }

      const config = await loadConfig();
      config.installed = config.installed.filter(id => id !== integrationId);
      await saveConfig(config);

      return { success: true, message: `${integrationId} uninstalled successfully` };
    } catch (error) {
      console.error(`[Marketplace] Error uninstalling:`, error);
      return { success: false, message: `Uninstall failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  async enable(integrationId: string, projectPath: string): Promise<{ success: boolean; message: string }> {
    try {
      const manifest = await getManifest(integrationId);
      if (!manifest) {
        return { success: false, message: `Integration ${integrationId} not installed` };
      }

      const initCommand = manifest.source.init_command;
      if (!initCommand) {
        return { success: false, message: `No init command defined for ${integrationId}` };
      }

      try {
        const output = await executeCommand(initCommand, projectPath);
        console.log(`[Marketplace] Init output:`, output);
        return { success: true, message: `${integrationId} enabled for project` };
      } catch (execError) {
        const errorMsg = execError instanceof Error ? execError.message : 'Command execution failed';
        console.warn(`[Marketplace] Command execution issue:`, errorMsg);
        return {
          success: true,
          message: `${integrationId} installed. Please run:\n\ncd "${projectPath}"\n${initCommand}`
        };
      }
    } catch (error) {
      console.error(`[Marketplace] Error enabling:`, error);
      return { success: false, message: `Enable failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  async disable(integrationId: string, _projectPath: string): Promise<{ success: boolean; message: string }> {
    try {
      return { success: true, message: `${integrationId} disabled for project` };
    } catch (error) {
      console.error(`[Marketplace] Error disabling:`, error);
      return { success: false, message: `Disable failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
};
