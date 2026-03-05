/**
 * FlowTrace Internal — Shared infrastructure for FlowTrace sub-modules.
 * NOT re-exported from the barrel (flowtraceService.ts).
 */

import type { McpServerConfig } from '../mcpConfigService';

export const FLOWTRACE_NAME = 'flowtrace';

export const flowtraceState = {
  installedCache: undefined as boolean | undefined,
  installedPromise: null as Promise<boolean> | null,
};

export function buildFlowtraceConfig(agentcockpitPath: string): McpServerConfig {
  return {
    command: 'node',
    args: [`${agentcockpitPath}/vendor/flowtrace-debugger/mcp-server/dist/server.js`],
  };
}

export function invalidateFlowtraceCaches(): void {
  flowtraceState.installedCache = undefined;
  flowtraceState.installedPromise = null;
}
