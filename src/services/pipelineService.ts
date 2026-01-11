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

// Get pipeline directory path
async function getPipelineDir(): Promise<string> {
  const home = await homeDir();
  if (!home) {
    throw new Error('Could not determine home directory');
  }
  return `${home}${PIPELINE_DIR}`;
}

// Ensure pipeline directory exists
export async function ensurePipelineDir(): Promise<void> {
  const dir = await getPipelineDir();
  const dirExists = await exists(dir);
  if (!dirExists) {
    await mkdir(dir, { recursive: true });
  }
}

// Read pipeline state
export async function getPipelineState(): Promise<PipelineState> {
  try {
    const dir = await getPipelineDir();
    const statePath = `${dir}/${STATE_FILE}`;

    const fileExists = await exists(statePath);
    if (!fileExists) {
      return getDefaultState();
    }

    const content = await readTextFile(statePath);
    return JSON.parse(content) as PipelineState;
  } catch (e) {
    console.error('[Pipeline] Failed to read state:', e);
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
    await writeTextFile(statePath, JSON.stringify(state, null, 2));
    return true;
  } catch (e) {
    console.error('[Pipeline] Failed to save state:', e);
    return false;
  }
}

// Get default state
function getDefaultState(): PipelineState {
  return {
    current_step: 0,
    completed_steps: [],
    session_id: null,
    started_at: null,
    last_activity: null,
    step_history: []
  };
}

// Reset pipeline to step 0
export async function resetPipeline(): Promise<boolean> {
  const state = getDefaultState();
  state.started_at = new Date().toISOString();
  return savePipelineState(state);
}

// Advance to next step manually
export async function advancePipeline(): Promise<PipelineState> {
  const state = await getPipelineState();
  const steps = await getPipelineSteps();

  if (state.current_step >= steps.length - 1) {
    return state; // Already at last step
  }

  const currentStep = steps[state.current_step];
  state.completed_steps.push({
    id: currentStep.id,
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

  for (const line of content.split('\n')) {
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
        id: idMatch ? idMatch[1] : stripped.split(':')[1].trim(),
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

  if (currentStep && currentStep.id) {
    steps.push(currentStep as PipelineStep);
  }

  return steps;
}

// Get pipeline steps configuration
export async function getPipelineSteps(): Promise<PipelineStep[]> {
  try {
    const dir = await getPipelineDir();
    const stepsPath = `${dir}/${STEPS_FILE}`;

    const fileExists = await exists(stepsPath);
    if (!fileExists) {
      return getDefaultSteps();
    }

    const content = await readTextFile(stepsPath);
    return parseStepsYaml(content);
  } catch (e) {
    console.error('[Pipeline] Failed to read steps:', e);
    return getDefaultSteps();
  }
}

// Generate YAML from steps
function stepsToYaml(steps: PipelineStep[]): string {
  let yaml = `# Flow-Controlled MCP Pipeline
# Generado por AgentCockpit

steps:\n`;

  for (const step of steps) {
    yaml += `  - id: "${step.id}"
    order: ${step.order}
    name: "${step.name}"
    description: "${step.description}"
    prompt_injection: |
${step.prompt_injection.split('\n').map(l => `      ${l}`).join('\n')}
    mcps_enabled:\n`;

    for (const mcp of step.mcps_enabled) {
      yaml += `      - "${mcp}"\n`;
    }

    yaml += `    tools_blocked:\n`;
    for (const tool of step.tools_blocked) {
      yaml += `      - "${tool}"\n`;
    }

    yaml += `    gate_type: "${step.gate_type}"
    gate_tool: "${step.gate_tool}"
    gate_phrases:\n`;

    for (const phrase of step.gate_phrases) {
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
    await writeTextFile(stepsPath, yaml);
    return true;
  } catch (e) {
    console.error('[Pipeline] Failed to save steps:', e);
    return false;
  }
}

// Get default steps (MVP)
function getDefaultSteps(): PipelineStep[] {
  return [
    {
      id: 'complexity-check',
      order: 0,
      name: 'Complexity Gate',
      description: 'Evalúa si la tarea requiere razonamiento estructurado',
      prompt_injection: `🔍 STEP 0 - COMPLEXITY CHECK
Antes de responder, evalúa:
- ¿Esta tarea tiene múltiples pasos interdependientes?
- ¿Hay ambigüedad que requiere descomponer?
- ¿El problema es complejo (>3 decisiones)?
Si SÍ → Usa sequential-thinking para estructurar tu razonamiento.
Si NO → Di "Tarea simple, procedo directamente" y continúa.`,
      mcps_enabled: ['sequential-thinking'],
      tools_blocked: ['Write', 'Edit'],
      gate_type: 'any',
      gate_tool: 'mcp__sequential-thinking__sequentialthinking',
      gate_phrases: ['Tarea simple, procedo directamente', 'tarea simple', 'procedo directamente']
    },
    {
      id: 'library-context',
      order: 1,
      name: 'Library Context Gate',
      description: 'Verifica si necesita documentación de librerías externas',
      prompt_injection: `📚 STEP 1 - LIBRARY CONTEXT
¿Esta tarea involucra librerías/frameworks externos?
(React, Vue, Node, Python libs, APIs, etc.)
Si SÍ → Consulta Context7 para obtener docs actualizadas.
Si NO → Di "No requiere documentación externa" y continúa.`,
      mcps_enabled: ['Context7'],
      tools_blocked: ['Write', 'Edit'],
      gate_type: 'any',
      gate_tool: 'mcp__Context7__',
      gate_phrases: ['No requiere documentación externa', 'no necesito documentación', 'sin librerías externas']
    },
    {
      id: 'implementation',
      order: 2,
      name: 'Implementation Gate',
      description: 'Habilita escritura después de validar contexto',
      prompt_injection: `✅ CONTEXTO VALIDADO
Steps completados. Puedes implementar.
Recuerda: Lee antes de escribir (FFD).`,
      mcps_enabled: ['*'],
      tools_blocked: [],
      gate_type: 'always',
      gate_tool: '',
      gate_phrases: []
    }
  ];
}

// Check if pipeline is installed (has controller)
export async function isPipelineInstalled(): Promise<boolean> {
  try {
    const dir = await getPipelineDir();
    const controllerPath = `${dir}/pipeline_controller.py`;
    return await exists(controllerPath);
  } catch {
    return false;
  }
}

// Get pipeline directory for external use
export async function getPipelinePath(): Promise<string> {
  return await getPipelineDir();
}
