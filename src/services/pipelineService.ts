import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs';

// Pipeline state interface
export interface PipelineState {
  current_step: number;
  completed_steps: CompletedStep[];
  session_id: string | null;
  started_at: string | null;
  last_activity: string | null;
  step_history: StepHistoryEntry[];
  // MCP pipeline-manager fields
  active_pipeline?: string | null;
  pipeline_version?: string | null;
  pipeline_source?: 'local' | 'global' | null;
}

export interface CompletedStep {
  id: string;
  completed_at: string;
  reason: string;
}

export interface StepHistoryEntry {
  from_step: number;
  to_step: number;
  timestamp: string;
  reason: string;
}

// Pipeline step configuration
export interface PipelineStep {
  id: string;
  order: number;
  name: string;
  description: string;
  prompt_injection: string;
  mcps_enabled: string[];
  tools_blocked: string[];
  gate_type: 'any' | 'tool' | 'phrase' | 'always';
  gate_tool: string;
  gate_phrases: string[];
}

// Full pipeline configuration
export interface PipelineConfig {
  steps: PipelineStep[];
}

// Paths
const PIPELINE_DIR = '.claude/pipeline';
const STATE_FILE = 'state.json';
const STEPS_FILE = 'steps.yaml';

// Cache the home directory
let cachedHomeDir: string | null = null;

// Get pipeline directory path
// If projectPath is provided, uses per-project path: {projectPath}/.claude/pipeline/
// Otherwise uses global path: ~/.claude/pipeline/
async function getPipelineDir(projectPath?: string | null): Promise<string> {
  if (projectPath) {
    // Per-project pipeline directory
    const normalizedPath = projectPath.endsWith('/') ? projectPath.slice(0, -1) : projectPath;
    return `${normalizedPath}/${PIPELINE_DIR}`;
  }

  // Global fallback
  if (!cachedHomeDir) {
    console.log('[Pipeline] Getting home directory...');
    const home = await homeDir();
    console.log('[Pipeline] Home directory:', home);

    if (!home) {
      throw new Error('Could not determine home directory');
    }
    // Normalize: remove trailing slash if present
    cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  }

  return `${cachedHomeDir}/${PIPELINE_DIR}`;
}

// Ensure pipeline directory exists
export async function ensurePipelineDir(projectPath?: string | null): Promise<void> {
  const dir = await getPipelineDir(projectPath);
  console.log('[Pipeline] Checking directory:', dir);

  try {
    const dirExists = await exists(dir);
    if (!dirExists) {
      console.log('[Pipeline] Creating directory:', dir);
      await mkdir(dir, { recursive: true });
    }
  } catch (e) {
    console.error('[Pipeline] Error ensuring directory:', e);
    throw e;
  }
}

// Get default state
function getDefaultState(): PipelineState {
  return {
    current_step: 0,
    completed_steps: [],
    session_id: null,
    started_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    step_history: [],
    active_pipeline: null,
    pipeline_version: null,
    pipeline_source: null
  };
}

// Read pipeline state
export async function getPipelineState(projectPath?: string | null): Promise<PipelineState> {
  try {
    const dir = await getPipelineDir(projectPath);
    const statePath = `${dir}/${STATE_FILE}`;
    console.log('[Pipeline] Reading state from:', statePath);

    const fileExists = await exists(statePath);
    if (!fileExists) {
      console.log('[Pipeline] State file not found, using defaults');
      return getDefaultState();
    }

    const content = await readTextFile(statePath);
    console.log('[Pipeline] State content length:', content.length);

    const parsed = JSON.parse(content) as PipelineState;
    return parsed;
  } catch (e) {
    console.error('[Pipeline] Error reading state:', e);
    return getDefaultState();
  }
}

// Save pipeline state
export async function savePipelineState(state: PipelineState, projectPath?: string | null): Promise<boolean> {
  try {
    await ensurePipelineDir(projectPath);
    const dir = await getPipelineDir(projectPath);
    const statePath = `${dir}/${STATE_FILE}`;

    state.last_activity = new Date().toISOString();
    const content = JSON.stringify(state, null, 2);

    console.log('[Pipeline] Saving state to:', statePath);
    await writeTextFile(statePath, content);
    return true;
  } catch (e) {
    console.error('[Pipeline] Error saving state:', e);
    return false;
  }
}

// Reset pipeline to step 0
export async function resetPipeline(projectPath?: string | null): Promise<boolean> {
  console.log('[Pipeline] Resetting pipeline...');
  const state = getDefaultState();
  return savePipelineState(state, projectPath);
}

// Advance to next step manually
export async function advancePipeline(projectPath?: string | null): Promise<PipelineState> {
  console.log('[Pipeline] Advancing pipeline...');
  const state = await getPipelineState(projectPath);
  const steps = await getPipelineSteps(projectPath);

  if (state.current_step >= steps.length - 1) {
    console.log('[Pipeline] Already at last step');
    return state;
  }

  const currentStep = steps[state.current_step];
  state.completed_steps.push({
    id: currentStep?.id || `step-${state.current_step}`,
    completed_at: new Date().toISOString(),
    reason: 'Manual advance'
  });

  state.step_history.push({
    from_step: state.current_step,
    to_step: state.current_step + 1,
    timestamp: new Date().toISOString(),
    reason: 'Manual advance'
  });

  state.current_step += 1;
  await savePipelineState(state, projectPath);
  return state;
}

// Parse YAML steps (simplified parser)
function parseStepsYaml(content: string): PipelineStep[] {
  const steps: PipelineStep[] = [];
  let currentStep: Partial<PipelineStep> | null = null;
  let currentList: string | null = null;
  let inMultiline = false;
  let multilineKey = '';
  let multilineContent: string[] = [];
  let indentLevel = 0;

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Skip comments and empty lines (but capture in multiline)
    if (!stripped || stripped.startsWith('#')) {
      if (inMultiline) {
        multilineContent.push('');
      }
      continue;
    }

    // Detect multiline start
    if (stripped.endsWith('|')) {
      inMultiline = true;
      multilineKey = stripped.slice(0, -1).trim().replace(':', '');
      multilineContent = [];
      indentLevel = line.length - line.trimStart().length;
      continue;
    }

    // Collect multiline content
    if (inMultiline) {
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent > indentLevel || stripped === '') {
        multilineContent.push(stripped);
        continue;
      } else {
        // End of multiline
        if (currentStep && multilineKey) {
          (currentStep as Record<string, unknown>)[multilineKey] = multilineContent.join('\n');
        }
        inMultiline = false;
        multilineKey = '';
      }
    }

    // New step
    if (stripped.startsWith('- id:')) {
      if (currentStep && currentStep.id) {
        steps.push(currentStep as PipelineStep);
      }
      const idMatch = stripped.match(/["']([^"']+)["']/);
      currentStep = {
        id: idMatch ? idMatch[1] : stripped.split(':')[1]?.trim() || `step-${steps.length}`,
        order: steps.length,
        name: '',
        description: '',
        prompt_injection: '',
        mcps_enabled: [],
        tools_blocked: [],
        gate_type: 'any',
        gate_tool: '',
        gate_phrases: []
      };
      currentList = null;
      continue;
    }

    // Step properties
    if (currentStep) {
      if (stripped.startsWith('- ')) {
        // List item
        if (currentList) {
          const value = stripped.slice(2).trim().replace(/^["']|["']$/g, '');
          const list = (currentStep as Record<string, unknown>)[currentList];
          if (Array.isArray(list)) {
            list.push(value);
          }
        }
      } else if (stripped.includes(':')) {
        const colonIndex = stripped.indexOf(':');
        const key = stripped.slice(0, colonIndex).trim();
        const value = stripped.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');

        if (!value) {
          // Start of list
          currentList = key;
          if (!(currentStep as Record<string, unknown>)[key]) {
            (currentStep as Record<string, unknown>)[key] = [];
          }
        } else {
          (currentStep as Record<string, unknown>)[key] = value;
          currentList = null;
        }
      }
    }
  }

  // Don't forget the last step
  if (currentStep && currentStep.id) {
    steps.push(currentStep as PipelineStep);
  }

  return steps;
}

// Get default steps (MVP)
function getDefaultSteps(): PipelineStep[] {
  return [
    {
      id: 'complexity-check',
      order: 0,
      name: 'Complexity Gate',
      description: 'Evalúa si la tarea requiere razonamiento estructurado',
      prompt_injection: '🔍 STEP 0 - COMPLEXITY CHECK\nAntes de responder, evalúa la complejidad.',
      mcps_enabled: ['sequential-thinking'],
      tools_blocked: ['Write', 'Edit'],
      gate_type: 'any',
      gate_tool: 'mcp__sequential-thinking__sequentialthinking',
      gate_phrases: ['Tarea simple', 'procedo directamente']
    },
    {
      id: 'library-context',
      order: 1,
      name: 'Library Context Gate',
      description: 'Verifica si necesita documentación de librerías',
      prompt_injection: '📚 STEP 1 - LIBRARY CONTEXT\n¿Necesitas documentación externa?',
      mcps_enabled: ['Context7'],
      tools_blocked: ['Write', 'Edit'],
      gate_type: 'any',
      gate_tool: 'mcp__Context7__',
      gate_phrases: ['No requiere documentación', 'sin librerías externas']
    },
    {
      id: 'implementation',
      order: 2,
      name: 'Implementation Gate',
      description: 'Habilita escritura después de validar contexto',
      prompt_injection: '✅ CONTEXTO VALIDADO\nPuedes implementar.',
      mcps_enabled: ['*'],
      tools_blocked: [],
      gate_type: 'always',
      gate_tool: '',
      gate_phrases: []
    }
  ];
}

// Get pipeline steps configuration
export async function getPipelineSteps(projectPath?: string | null): Promise<PipelineStep[]> {
  try {
    const dir = await getPipelineDir(projectPath);
    const stepsPath = `${dir}/${STEPS_FILE}`;
    console.log('[Pipeline] Reading steps from:', stepsPath);

    const fileExists = await exists(stepsPath);
    if (!fileExists) {
      console.log('[Pipeline] Steps file not found, using defaults');
      return getDefaultSteps();
    }

    const content = await readTextFile(stepsPath);
    console.log('[Pipeline] Steps content length:', content.length);

    const parsed = parseStepsYaml(content);
    console.log('[Pipeline] Parsed steps count:', parsed.length);

    if (parsed.length === 0) {
      console.log('[Pipeline] No steps parsed, using defaults');
      return getDefaultSteps();
    }

    return parsed;
  } catch (e) {
    console.error('[Pipeline] Error reading steps:', e);
    return getDefaultSteps();
  }
}

// Generate YAML from steps
function stepsToYaml(steps: PipelineStep[]): string {
  let yaml = `# Flow-Controlled MCP Pipeline
# Generated by AgentCockpit

steps:\n`;

  for (const step of steps) {
    yaml += `  - id: "${step.id}"
    order: ${step.order}
    name: "${step.name}"
    description: "${step.description}"
    prompt_injection: |
${step.prompt_injection.split('\n').map(l => `      ${l}`).join('\n')}
    mcps_enabled:\n`;

    for (const mcp of step.mcps_enabled || []) {
      yaml += `      - "${mcp}"\n`;
    }

    yaml += `    tools_blocked:\n`;
    for (const tool of step.tools_blocked || []) {
      yaml += `      - "${tool}"\n`;
    }

    yaml += `    gate_type: "${step.gate_type}"
    gate_tool: "${step.gate_tool}"
    gate_phrases:\n`;

    for (const phrase of step.gate_phrases || []) {
      yaml += `      - "${phrase}"\n`;
    }

    yaml += '\n';
  }

  return yaml;
}

// Save pipeline steps
export async function savePipelineSteps(steps: PipelineStep[], projectPath?: string | null): Promise<boolean> {
  try {
    await ensurePipelineDir(projectPath);
    const dir = await getPipelineDir(projectPath);
    const stepsPath = `${dir}/${STEPS_FILE}`;

    const yaml = stepsToYaml(steps);
    console.log('[Pipeline] Saving steps to:', stepsPath);
    await writeTextFile(stepsPath, yaml);
    return true;
  } catch (e) {
    console.error('[Pipeline] Error saving steps:', e);
    return false;
  }
}

// Check if pipeline is installed (directory exists)
export async function isPipelineInstalled(projectPath?: string | null): Promise<boolean> {
  try {
    const dir = await getPipelineDir(projectPath);
    // Check if the pipeline directory exists
    const dirExists = await exists(dir);
    console.log('[Pipeline] Directory exists:', dirExists, 'at', dir);

    if (!dirExists) {
      return false;
    }

    // If we can read steps (even defaults), consider it "installed"
    // The actual hooks are configured in .claude/settings.json
    // which is separate from this UI
    return true;
  } catch (e) {
    console.error('[Pipeline] Error checking installation:', e);
    return false;
  }
}

// Get pipeline directory for external use
export async function getPipelinePath(projectPath?: string | null): Promise<string> {
  return await getPipelineDir(projectPath);
}

// ============================================
// Pipeline Configuration
// ============================================

export interface PipelineSettings {
  reset_policy: 'manual' | 'timeout' | 'per_session';
  timeout_minutes: number;
  force_sequential: boolean;
}

const DEFAULT_SETTINGS: PipelineSettings = {
  reset_policy: 'timeout',
  timeout_minutes: 30,
  force_sequential: false
};

// Parse config section from steps.yaml content
function parseConfigFromYaml(content: string): PipelineSettings {
  const config = { ...DEFAULT_SETTINGS };
  const lines = content.split('\n');
  let inConfig = false;

  for (const line of lines) {
    const stripped = line.trim();

    if (stripped === 'config:') {
      inConfig = true;
      continue;
    }

    if (stripped === 'steps:') {
      break;
    }

    if (inConfig && stripped.includes(':') && !stripped.startsWith('#')) {
      const [key, ...valueParts] = stripped.split(':');
      const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');

      if (key.trim() === 'reset_policy' && ['manual', 'timeout', 'per_session'].includes(value)) {
        config.reset_policy = value as PipelineSettings['reset_policy'];
      } else if (key.trim() === 'timeout_minutes') {
        config.timeout_minutes = parseInt(value, 10) || 30;
      } else if (key.trim() === 'force_sequential') {
        config.force_sequential = value.toLowerCase() === 'true';
      }
    }
  }

  return config;
}

// Get pipeline settings
export async function getPipelineSettings(projectPath?: string | null): Promise<PipelineSettings> {
  try {
    const dir = await getPipelineDir(projectPath);
    const stepsPath = `${dir}/${STEPS_FILE}`;

    const fileExists = await exists(stepsPath);
    if (!fileExists) {
      return DEFAULT_SETTINGS;
    }

    const content = await readTextFile(stepsPath);
    return parseConfigFromYaml(content);
  } catch (e) {
    console.error('[Pipeline] Error reading settings:', e);
    return DEFAULT_SETTINGS;
  }
}

// Save pipeline settings
export async function savePipelineSettings(settings: PipelineSettings, projectPath?: string | null): Promise<boolean> {
  try {
    const dir = await getPipelineDir(projectPath);
    const stepsPath = `${dir}/${STEPS_FILE}`;

    const fileExists = await exists(stepsPath);
    if (!fileExists) {
      return false;
    }

    const content = await readTextFile(stepsPath);
    const lines = content.split('\n');
    const newLines: string[] = [];
    let inConfig = false;

    for (const line of lines) {
      const stripped = line.trim();

      if (stripped === 'config:') {
        inConfig = true;
        newLines.push(line);
        // Write new config values
        newLines.push(`  reset_policy: "${settings.reset_policy}"`);
        newLines.push(`  timeout_minutes: ${settings.timeout_minutes}`);
        newLines.push(`  force_sequential: ${settings.force_sequential}`);
        continue;
      }

      if (inConfig && stripped === 'steps:') {
        inConfig = false;
        newLines.push('');
        newLines.push(line);
        continue;
      }

      if (inConfig && !stripped.startsWith('#') && stripped.includes(':')) {
        // Skip old config lines
        continue;
      }

      newLines.push(line);
    }

    await writeTextFile(stepsPath, newLines.join('\n'));
    return true;
  } catch (e) {
    console.error('[Pipeline] Error saving settings:', e);
    return false;
  }
}

// ============================================
// Available MCPs Discovery
// ============================================

export interface AvailableMcp {
  name: string;
  source: 'claude_desktop' | 'claude_code';
  command?: string;
}

// Standard Claude tools that are always available
export const STANDARD_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit',
  'AskUserQuestion'
];

// Get available MCPs from Claude Desktop config
export async function getAvailableMcps(): Promise<AvailableMcp[]> {
  const mcps: AvailableMcp[] = [];

  try {
    // Try Claude Desktop config
    const home = await homeDir();
    const claudeDesktopPath = `${home}/Library/Application Support/Claude/claude_desktop_config.json`;

    const desktopExists = await exists(claudeDesktopPath);
    if (desktopExists) {
      const content = await readTextFile(claudeDesktopPath);
      const config = JSON.parse(content);

      if (config.mcpServers) {
        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          mcps.push({
            name,
            source: 'claude_desktop',
            command: (serverConfig as { command?: string }).command
          });
        }
      }
    }
  } catch (e) {
    console.error('[Pipeline] Error reading Claude Desktop config:', e);
  }

  // Add wildcard option
  mcps.unshift({ name: '*', source: 'claude_desktop' });

  return mcps;
}

// ============================================
// Global Pipelines Management
// ============================================

const GLOBAL_PIPELINES_DIR = '.claude/pipelines';

// App project directory for global pipelines (bundled with the app)
// In development: uses the project directory
// In production: could use appDataDir() from Tauri
let cachedAppDir: string | null = null;

export interface GlobalPipelineInfo {
  name: string;
  displayName: string;
  description: string;
  stepsCount: number;
}

// Get the app's base directory for global resources
async function getAppBaseDir(): Promise<string> {
  if (cachedAppDir) {
    return cachedAppDir;
  }

  // Try to detect if we're in development or production
  // In development, __dirname or import.meta would point to the project
  // For now, we use a known project path that can be configured

  // Check for AGENTCOCKPIT_DIR environment variable first (for flexibility)
  // @ts-ignore - window.__TAURI__ may exist
  if (typeof window !== 'undefined' && window.__TAURI__) {
    try {
      // In Tauri, try to get the resource directory or app data directory
      const { appDataDir } = await import('@tauri-apps/api/path');
      const dataDir = await appDataDir();
      if (dataDir) {
        // Use app data dir but look for pipelines in a known location
        // For now, fallback to home-based detection
      }
    } catch {
      // Ignore errors, fallback below
    }
  }

  // Fallback: Use home directory + known project path
  // This allows the app to find pipelines bundled with the project
  if (!cachedHomeDir) {
    const home = await homeDir();
    if (!home) {
      throw new Error('Could not determine home directory');
    }
    cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  }

  // Default to project directory (can be overridden via config)
  // The pipelines are now stored in the agentcockpit project itself
  cachedAppDir = `${cachedHomeDir}/my_projects/agentcockpit`;

  return cachedAppDir;
}

// Get global pipelines directory path
// Now uses the app's project directory instead of home directory
async function getGlobalPipelinesDir(): Promise<string> {
  const appDir = await getAppBaseDir();
  return `${appDir}/${GLOBAL_PIPELINES_DIR}`;
}

// Parse pipeline metadata from YAML content
function parsePipelineMetadata(content: string): { displayName: string; description: string; stepsCount: number } {
  let displayName = '';
  let description = '';
  let stepsCount = 0;
  let inMetadata = false;

  const lines = content.split('\n');
  for (const line of lines) {
    const stripped = line.trim();

    if (stripped === 'metadata:') {
      inMetadata = true;
      continue;
    }

    if (stripped === 'config:' || stripped === 'steps:') {
      inMetadata = false;
    }

    if (inMetadata && stripped.includes(':')) {
      const [key, ...valueParts] = stripped.split(':');
      const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');

      if (key.trim() === 'name') {
        displayName = value;
      } else if (key.trim() === 'description') {
        description = value;
      }
    }

    // Count steps
    if (stripped.startsWith('- id:')) {
      stepsCount++;
    }
  }

  return { displayName, description, stepsCount };
}

// List all global pipelines
export async function listGlobalPipelines(): Promise<GlobalPipelineInfo[]> {
  const pipelines: GlobalPipelineInfo[] = [];

  try {
    const dir = await getGlobalPipelinesDir();
    const dirExists = await exists(dir);

    if (!dirExists) {
      console.log('[Pipeline] Global pipelines directory does not exist');
      return pipelines;
    }

    // Read directory contents using Tauri readDir
    const entries = await readDir(dir);
    console.log('[Pipeline] Directory entries:', entries.length);

    for (const entry of entries) {
      // Only process .yaml files
      if (entry.name && entry.name.endsWith('.yaml')) {
        const name = entry.name.replace('.yaml', '');
        const filePath = `${dir}/${entry.name}`;

        try {
          const content = await readTextFile(filePath);
          const metadata = parsePipelineMetadata(content);
          pipelines.push({
            name,
            displayName: metadata.displayName || name,
            description: metadata.description || '',
            stepsCount: metadata.stepsCount
          });
        } catch (e) {
          console.error('[Pipeline] Error reading pipeline file:', filePath, e);
        }
      }
    }

    console.log('[Pipeline] Found global pipelines:', pipelines.length);
    return pipelines;
  } catch (e) {
    console.error('[Pipeline] Error listing global pipelines:', e);
    return pipelines;
  }
}

// Get active pipeline name for a project
export async function getActivePipelineName(projectPath: string | null): Promise<string | null> {
  if (!projectPath) return null;

  try {
    const dir = await getPipelineDir(projectPath);
    const statePath = `${dir}/${STATE_FILE}`;

    const fileExists = await exists(statePath);
    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(statePath);
    const state = JSON.parse(content);
    return state.active_pipeline || null;
  } catch (e) {
    console.error('[Pipeline] Error getting active pipeline:', e);
    return null;
  }
}

// Activate a global pipeline for a project
export async function activatePipeline(projectPath: string, pipelineName: string): Promise<boolean> {
  try {
    await ensurePipelineDir(projectPath);
    const dir = await getPipelineDir(projectPath);
    const statePath = `${dir}/${STATE_FILE}`;

    // Load existing state or create new
    let state: PipelineState;

    const fileExists = await exists(statePath);
    if (fileExists) {
      const content = await readTextFile(statePath);
      state = JSON.parse(content);
    } else {
      state = getDefaultState();
    }

    // Update with new active pipeline
    state.active_pipeline = pipelineName;
    state.pipeline_version = '1.0.0';
    state.current_step = 0;
    state.completed_steps = [];
    state.step_history = [];
    state.started_at = new Date().toISOString();
    state.last_activity = new Date().toISOString();

    await writeTextFile(statePath, JSON.stringify(state, null, 2));
    console.log('[Pipeline] Activated pipeline:', pipelineName, 'for project:', projectPath);
    return true;
  } catch (e) {
    console.error('[Pipeline] Error activating pipeline:', e);
    return false;
  }
}

// Deactivate pipeline for a project
export async function deactivatePipeline(projectPath: string): Promise<boolean> {
  try {
    const dir = await getPipelineDir(projectPath);
    const statePath = `${dir}/${STATE_FILE}`;

    const fileExists = await exists(statePath);
    if (!fileExists) {
      return true;
    }

    const content = await readTextFile(statePath);
    const state = JSON.parse(content);

    state.active_pipeline = null;
    state.pipeline_version = null;
    state.last_activity = new Date().toISOString();

    await writeTextFile(statePath, JSON.stringify(state, null, 2));
    console.log('[Pipeline] Deactivated pipeline for project:', projectPath);
    return true;
  } catch (e) {
    console.error('[Pipeline] Error deactivating pipeline:', e);
    return false;
  }
}

// Get global pipeline steps by name
export async function getGlobalPipelineSteps(pipelineName: string): Promise<PipelineStep[]> {
  try {
    const dir = await getGlobalPipelinesDir();
    const filePath = `${dir}/${pipelineName}.yaml`;

    const fileExists = await exists(filePath);
    if (!fileExists) {
      console.log('[Pipeline] Global pipeline not found:', pipelineName);
      return [];
    }

    const content = await readTextFile(filePath);
    return parseStepsYaml(content);
  } catch (e) {
    console.error('[Pipeline] Error reading global pipeline:', e);
    return [];
  }
}
