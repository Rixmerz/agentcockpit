import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';

// Pipeline state interface
export interface PipelineState {
  current_step: number;
  completed_steps: CompletedStep[];
  session_id: string | null;
  started_at: string | null;
  last_activity: string | null;
  step_history: StepHistoryEntry[];
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
  gate_type: 'any' | 'always';
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
async function getPipelineDir(): Promise<string> {
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
export async function ensurePipelineDir(): Promise<void> {
  const dir = await getPipelineDir();
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
    step_history: []
  };
}

// Read pipeline state
export async function getPipelineState(): Promise<PipelineState> {
  try {
    const dir = await getPipelineDir();
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
export async function savePipelineState(state: PipelineState): Promise<boolean> {
  try {
    await ensurePipelineDir();
    const dir = await getPipelineDir();
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
export async function resetPipeline(): Promise<boolean> {
  console.log('[Pipeline] Resetting pipeline...');
  const state = getDefaultState();
  return savePipelineState(state);
}

// Advance to next step manually
export async function advancePipeline(): Promise<PipelineState> {
  console.log('[Pipeline] Advancing pipeline...');
  const state = await getPipelineState();
  const steps = await getPipelineSteps();

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
  await savePipelineState(state);
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
export async function getPipelineSteps(): Promise<PipelineStep[]> {
  try {
    const dir = await getPipelineDir();
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
export async function savePipelineSteps(steps: PipelineStep[]): Promise<boolean> {
  try {
    await ensurePipelineDir();
    const dir = await getPipelineDir();
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

// Check if pipeline is installed (has controller)
export async function isPipelineInstalled(): Promise<boolean> {
  try {
    const dir = await getPipelineDir();
    const controllerPath = `${dir}/pipeline_controller.py`;
    const installed = await exists(controllerPath);
    console.log('[Pipeline] Controller installed:', installed);
    return installed;
  } catch (e) {
    console.error('[Pipeline] Error checking installation:', e);
    return false;
  }
}

// Get pipeline directory for external use
export async function getPipelinePath(): Promise<string> {
  return await getPipelineDir();
}
