/**
 * FlowTrace Install Service — install, uninstall, check installation
 */

import { exists } from '@tauri-apps/plugin-fs';
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
import { FLOWTRACE_NAME, flowtraceState, buildFlowtraceConfig, invalidateFlowtraceCaches } from './_flowtraceInternal';

export async function isFlowtraceInstalled(): Promise<boolean> {
  if (flowtraceState.installedCache !== undefined) return flowtraceState.installedCache;
  if (!flowtraceState.installedPromise) {
    flowtraceState.installedPromise = loadMcpConfig().then(config => {
      flowtraceState.installedCache = !!config.mcpServers[FLOWTRACE_NAME];
      flowtraceState.installedPromise = null;
      return flowtraceState.installedCache;
    }).catch(() => {
      flowtraceState.installedPromise = null;
      return false;
    });
  }
  return flowtraceState.installedPromise;
}

export async function isFlowtraceEnabled(): Promise<boolean> {
  const installed = await isFlowtraceInstalled();
  if (!installed) return false;
  const config = await loadMcpConfig();
  const mcp = config.mcpServers[FLOWTRACE_NAME];
  return !!mcp && !mcp.config.disabled;
}

export async function installFlowtraceMcp(agentcockpitPath?: string): Promise<{ success: boolean; message: string }> {
  try {
    let installPath: string | undefined = agentcockpitPath;
    if (!installPath) {
      installPath = await getAgentcockpitPath() ?? undefined;
    }

    if (!installPath) {
      return { success: false, message: 'AgentCockpit path not configured. Please set it first.' };
    }

    const serverFile = `${installPath}/vendor/flowtrace-debugger/mcp-server/dist/server.js`;
    const serverExists = await exists(serverFile);
    if (!serverExists) {
      return { success: false, message: `FlowTrace server not found at ${serverFile}` };
    }

    await setAgentcockpitPath(installPath);

    const config = await loadMcpConfig();
    const mcpConfig = buildFlowtraceConfig(installPath);

    if (config.mcpServers[FLOWTRACE_NAME]) {
      config.mcpServers[FLOWTRACE_NAME].config = mcpConfig;
      config.mcpServers[FLOWTRACE_NAME].config.disabled = false;
      await saveMcpConfig(config);
      const cliResult = await addCodeMcp(FLOWTRACE_NAME, mcpConfig);
      if (!cliResult.success) {
        const fileOk = await addMcpToClaudeCode(FLOWTRACE_NAME, mcpConfig);
        if (!fileOk) return { success: false, message: 'Failed to register MCP in Claude Code' };
      }
      invalidateFlowtraceCaches();
      return { success: true, message: 'FlowTrace MCP updated and enabled' };
    }

    config.mcpServers[FLOWTRACE_NAME] = {
      name: FLOWTRACE_NAME,
      config: mcpConfig,
      importedFrom: 'manual',
      importedAt: new Date().toISOString(),
      notes: `Auto-installed by AgentCockpit from ${installPath}/vendor/flowtrace-debugger`
    };

    const saved = await saveMcpConfig(config);
    if (saved) {
      const cliResult = await addCodeMcp(FLOWTRACE_NAME, mcpConfig);
      if (!cliResult.success) {
        const fileOk = await addMcpToClaudeCode(FLOWTRACE_NAME, mcpConfig);
        if (!fileOk) return { success: false, message: 'Failed to register MCP in Claude Code' };
      }
      invalidateFlowtraceCaches();
      return { success: true, message: 'FlowTrace MCP installed successfully' };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

export async function uninstallFlowtraceMcp(): Promise<{ success: boolean; message: string }> {
  const result = await removeMcp(FLOWTRACE_NAME);
  const cliResult = await removeCodeMcp(FLOWTRACE_NAME);
  if (!cliResult.success) {
    await removeMcpFromClaudeCode(FLOWTRACE_NAME);
  }
  invalidateFlowtraceCaches();
  return result;
}
