/**
 * DCC Install Service — install, uninstall, check installation
 */

import { exists } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import {
  loadMcpConfig,
  saveMcpConfig,
  getAgentcockpitPath,
  setAgentcockpitPath,
  addMcpToClaudeCode,
  removeMcpFromClaudeCode,
  removeMcp,
} from '../mcpConfigService';
import { addCodeMcp, removeCodeMcp } from '../mcpService';
import { DCC_NAME, dccState, buildDeltaCodeCubeConfig, invalidateDccCaches } from './_dccInternal';

export async function isDeltaCodeCubeInstalled(): Promise<boolean> {
  if (dccState.installedCache !== undefined) return dccState.installedCache;
  if (!dccState.installedPromise) {
    dccState.installedPromise = loadMcpConfig().then(config => {
      dccState.installedCache = !!config.mcpServers[DCC_NAME];
      dccState.installedPromise = null;
      return dccState.installedCache;
    }).catch(() => {
      dccState.installedPromise = null;
      return false;
    });
  }
  return dccState.installedPromise;
}

export async function isDeltaCodeCubeEnabled(): Promise<boolean> {
  const installed = await isDeltaCodeCubeInstalled();
  if (!installed) return false;
  const config = await loadMcpConfig();
  const mcp = config.mcpServers[DCC_NAME];
  return !!mcp && !mcp.config.disabled;
}

export async function installDeltaCodeCubeMcp(agentcockpitPath?: string): Promise<{ success: boolean; message: string }> {
  try {
    let installPath: string | undefined = agentcockpitPath;
    if (!installPath) {
      installPath = await getAgentcockpitPath() ?? undefined;
    }

    if (!installPath) {
      return { success: false, message: 'AgentCockpit path not configured. Please set it first.' };
    }

    const dccPath = `${installPath}/.deltacodecube`;
    const dccExists = await exists(dccPath);
    if (!dccExists) {
      return { success: false, message: `DeltaCodeCube not found at ${dccPath}` };
    }

    await setAgentcockpitPath(installPath);

    const config = await loadMcpConfig();
    const mcpConfig = buildDeltaCodeCubeConfig(installPath);

    if (config.mcpServers[DCC_NAME]) {
      config.mcpServers[DCC_NAME].config = mcpConfig;
      config.mcpServers[DCC_NAME].config.disabled = false;
      await saveMcpConfig(config);
      const cliResult = await addCodeMcp(DCC_NAME, mcpConfig);
      if (!cliResult.success) {
        const fileOk = await addMcpToClaudeCode(DCC_NAME, mcpConfig);
        if (!fileOk) return { success: false, message: 'Failed to register MCP in Claude Code' };
      }
      invalidateDccCaches();
      return { success: true, message: 'DeltaCodeCube MCP updated and enabled' };
    }

    config.mcpServers[DCC_NAME] = {
      name: DCC_NAME,
      config: mcpConfig,
      importedFrom: 'manual',
      importedAt: new Date().toISOString(),
      notes: `Auto-installed by AgentCockpit from ${dccPath}`
    };

    const saved = await saveMcpConfig(config);
    if (saved) {
      const cliResult = await addCodeMcp(DCC_NAME, mcpConfig);
      if (!cliResult.success) {
        const fileOk = await addMcpToClaudeCode(DCC_NAME, mcpConfig);
        if (!fileOk) return { success: false, message: 'Failed to register MCP in Claude Code' };
      }
      invalidateDccCaches();
      return { success: true, message: 'DeltaCodeCube MCP installed successfully' };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

export async function uninstallDeltaCodeCubeMcp(): Promise<{ success: boolean; message: string }> {
  // Stop the server if running
  try { await invoke('dcc_stop'); } catch { /* ignore */ }
  const result = await removeMcp(DCC_NAME);
  const cliResult = await removeCodeMcp(DCC_NAME);
  if (!cliResult.success) {
    await removeMcpFromClaudeCode(DCC_NAME);
  }
  invalidateDccCaches();
  return result;
}
