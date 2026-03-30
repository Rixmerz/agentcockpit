/**
 * Hook Service
 *
 * Manages Claude Code hooks for workflow enforcement.
 * Handles .claude/settings.json and hook scripts.
 */

import { readTextFile, writeTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs';
import type { WorkflowStep } from '../types';
import { resetWorkflow } from './workflowService';
import workflowEnforcerTemplate from '../scripts/workflow_enforcer_template.py?raw';
import reindexTriggerTemplate from '../scripts/reindex_trigger_template.py?raw';
import dccFeedbackTemplate from '../scripts/dcc_feedback_template.py?raw';
// Bundled defaults — imported at build time so they don't depend on filesystem paths
import rulesCheckerPy from '../../.claude/hooks/rules_checker.py?raw';
import experienceRecorderPy from '../../.claude/hooks/experience_recorder.py?raw';
import experienceInjectorPy from '../../.claude/hooks/experience_injector.py?raw';
import memoryInjectorPy from '../../.claude/hooks/memory_injector.py?raw';
import commonPy from '../../.claude/hooks/_common.py?raw';
import ruleAutonomousStrategy from '../../.claude/rules/autonomous-strategy.md?raw';
import ruleWorkflowDiscipline from '../../.claude/rules/workflow-discipline.md?raw';
import ruleSubagentDelegation from '../../.claude/rules/subagent-delegation.md?raw';
import ruleQualityFeedback from '../../.claude/rules/quality-feedback.md?raw';
import ruleCommitDiscipline from '../../.claude/rules/commit-discipline.md?raw';
import ruleExecutionPhilosophy from '../../.claude/rules/execution-philosophy.md?raw';
import commandSetupAgents from '../../.claude/commands/setup-agents.md?raw';

// Claude settings.json structure
export interface ClaudeHookConfig {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface ClaudeHookMatcher {
  matcher: string;
  hooks: ClaudeHookConfig[];
}

export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: ClaudeHookMatcher[];
    PostToolUse?: ClaudeHookMatcher[];
    [key: string]: ClaudeHookMatcher[] | undefined;
  };
  _workflow_managed?: boolean;
  [key: string]: unknown;
}

export interface HookResult {
  success: boolean;
  error?: string;
}

// ============================================
// Read/Write Claude Settings
// ============================================

/**
 * Read Claude settings.json from project
 */
export async function readClaudeSettings(projectPath: string): Promise<ClaudeSettings | null> {
  try {
    const settingsPath = `${projectPath}/.claude/settings.json`;
    const fileExists = await exists(settingsPath);

    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(settingsPath);
    return JSON.parse(content);
  } catch (e) {
    console.error('[HookService] Error reading settings:', e);
    return null;
  }
}

/**
 * Write Claude settings.json to project
 */
export async function writeClaudeSettings(
  projectPath: string,
  settings: ClaudeSettings
): Promise<boolean> {
  try {
    const claudeDir = `${projectPath}/.claude`;
    const settingsPath = `${claudeDir}/settings.json`;

    // Ensure .claude directory exists
    const dirExists = await exists(claudeDir);
    if (!dirExists) {
      await mkdir(claudeDir, { recursive: true });
    }

    const content = JSON.stringify(settings, null, 2);
    await writeTextFile(settingsPath, content);
    return true;
  } catch (e) {
    console.error('[HookService] Error writing settings:', e);
    return false;
  }
}

// ============================================
// Workflow Skill Generation
// ============================================

/**
 * Generate the /workflow skill for Claude Code
 */
export function generateWorkflowSkill(projectPath: string): string {
  return `---
name: workflow
description: Gestiona el workflow de flujo controlado. Usa para ver estado, avanzar, resetear o ir a un step específico del workflow.
user-invocable: true
---

# Workflow Management

Gestiona el workflow de flujo controlado para este proyecto.

## Subcomandos

Parsea \`$ARGUMENTS\` para determinar la acción:

- **vacío o "status"** → Mostrar estado actual
- **"advance"** → Avanzar al siguiente step
- **"reset"** → Resetear a step 0
- **"set N"** → Ir directamente al step N

## Ejecución

El \`project_dir\` para este proyecto es: \`${projectPath}\`

### Para status (default):
Llama a \`mcp__workflow-manager__workflow_status\` con \`project_dir="${projectPath}"\`.

Muestra el resultado en formato tabla:
\`\`\`
Workflow: Step {current_step} - {step_name}

| # | Nombre | Estado | Bloqueados |
|---|--------|--------|------------|
\`\`\`

### Para advance:
Llama a \`mcp__workflow-manager__workflow_advance\` con \`project_dir="${projectPath}"\`.
Confirma: "Avanzado a Step N - {nombre}"

### Para reset:
Llama a \`mcp__workflow-manager__workflow_reset\` con \`project_dir="${projectPath}"\`.
Confirma: "Workflow reseteado a Step 0"

### Para set N:
Llama a \`mcp__workflow-manager__workflow_set_step\` con \`project_dir="${projectPath}"\` y \`step_index=N\`.
Confirma: "Workflow en Step N - {nombre}"

## Notas

- Write/Edit están bloqueados en steps 0 y 1
- Usa \`/workflow advance\` o \`/workflow set 2\` para desbloquear
`;
}

// Workflow Enforcer Script Generation
// ============================================

/**
 * Generate the Python workflow enforcer script
 */
export function generateWorkflowEnforcerScript(projectPath: string): string {
  return workflowEnforcerTemplate.replace('{{PROJECT_PATH}}', projectPath);
}

// ============================================
// Hook Installation
// ============================================

/**
 * Install workflow hooks into a project
 */
export async function installWorkflowHooks(
  projectPath: string,
  _steps?: WorkflowStep[]  // Kept for future use (e.g., generating step-specific hooks)
): Promise<HookResult> {
  try {
    // 1. Ensure .claude/hooks directory exists
    const hooksDir = `${projectPath}/.claude/hooks`;
    const hooksDirExists = await exists(hooksDir);
    if (!hooksDirExists) {
      await mkdir(hooksDir, { recursive: true });
    }

    // 2. Generate and write enforcer script
    const enforcerPath = `${hooksDir}/workflow_enforcer.py`;
    const enforcerScript = generateWorkflowEnforcerScript(projectPath);
    await writeTextFile(enforcerPath, enforcerScript);

    // 2.1. Write DCC feedback PostToolUse hook
    const dccFeedbackScript = dccFeedbackTemplate.replace(
      /\{\{PROJECT_PATH\}\}/g,
      projectPath
    );
    await writeTextFile(`${hooksDir}/dcc_feedback.py`, dccFeedbackScript);

    // 2.5. Initialize workflow state (state.json at step 0)
    await resetWorkflow(projectPath);

    // 2.6. Create /workflow skill for Claude Code
    const skillsDir = `${projectPath}/.claude/skills/workflow`;
    const skillsDirExists = await exists(skillsDir);
    if (!skillsDirExists) {
      await mkdir(skillsDir, { recursive: true });
    }
    const skillPath = `${skillsDir}/SKILL.md`;
    const skillContent = generateWorkflowSkill(projectPath);
    await writeTextFile(skillPath, skillContent);

    // 3. Read existing settings (preserve other hooks)
    let settings = await readClaudeSettings(projectPath) || {};

    // 4. Add workflow hook configuration
    const workflowHook: ClaudeHookConfig = {
      type: 'command',
      command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/workflow_enforcer.py"`,
      timeout: 5
    };

    const workflowMatcher: ClaudeHookMatcher = {
      matcher: '*',
      hooks: [workflowHook]
    };

    // Initialize hooks if not present
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // Get existing PreToolUse hooks (filter out any previous workflow hooks)
    const existingPreToolUse = (settings.hooks.PreToolUse || []).filter(
      matcher => !matcher.hooks.some(h => h.command.includes('workflow_enforcer'))
    );

    // Add workflow matcher
    settings.hooks.PreToolUse = [...existingPreToolUse, workflowMatcher];
    settings._workflow_managed = true;

    // Initialize PostToolUse array if it doesn't exist
    if (!settings.hooks.PostToolUse) {
      settings.hooks.PostToolUse = [];
    }

    // Add DCC feedback hook for Edit|Write (filter out any previous dcc_feedback hooks first)
    const existingPostToolUse = settings.hooks.PostToolUse.filter(
      matcher => !matcher.hooks.some(h => h.command.includes('dcc_feedback'))
    );
    existingPostToolUse.push({
      matcher: 'Edit|Write',
      hooks: [{
        type: 'command',
        command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/dcc_feedback.py"`,
        timeout: 5,
      }],
    });
    settings.hooks.PostToolUse = existingPostToolUse;

    // 5. Write settings
    const success = await writeClaudeSettings(projectPath, settings);

    if (!success) {
      return { success: false, error: 'Failed to write settings.json' };
    }

    // 6. Install AS.md and update CLAUDE.md
    await installAsMarkdown(projectPath);

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[HookService] Install error:', error);
    return { success: false, error };
  }
}

/**
 * Uninstall workflow hooks from a project
 */
export async function uninstallWorkflowHooks(projectPath: string): Promise<HookResult> {
  try {
    // 1. Read existing settings
    const settings = await readClaudeSettings(projectPath);

    if (settings && settings.hooks) {
      // Remove workflow hooks from PreToolUse
      if (settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
          matcher => !matcher.hooks.some(h => h.command.includes('workflow_enforcer'))
        );

        // Clean up empty array
        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
      }

      // Remove DCC feedback hooks from PostToolUse
      if (settings.hooks.PostToolUse) {
        settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
          matcher => !matcher.hooks.some(h => h.command.includes('dcc_feedback'))
        );

        // Clean up empty array
        if (settings.hooks.PostToolUse.length === 0) {
          delete settings.hooks.PostToolUse;
        }
      }

      // Clean up empty hooks object
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      delete settings._workflow_managed;

      // Write updated settings
      await writeClaudeSettings(projectPath, settings);
    }

    // 2. Remove enforcer script
    const enforcerPath = `${projectPath}/.claude/hooks/workflow_enforcer.py`;
    const enforcerExists = await exists(enforcerPath);
    if (enforcerExists) {
      await remove(enforcerPath);
    }

    // 3. Remove DCC feedback script and cache files
    const hooksDir = `${projectPath}/.claude/hooks`;
    const dccFiles = [
      `${hooksDir}/dcc_feedback.py`,
      `${hooksDir}/.dcc_smells_cache.json`,
      `${hooksDir}/.dcc_smells_baseline.json`,
      `${hooksDir}/.dcc_batch.json`,
    ];
    for (const filePath of dccFiles) {
      const fileExists = await exists(filePath);
      if (fileExists) {
        await remove(filePath);
      }
    }

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[HookService] Uninstall error:', error);
    return { success: false, error };
  }
}

// ============================================
// Hook Status
// ============================================

/**
 * Check if workflow hooks are installed in a project
 */
export async function isWorkflowHooksInstalled(projectPath: string): Promise<boolean> {
  try {
    const settings = await readClaudeSettings(projectPath);

    if (!settings || !settings.hooks || !settings.hooks.PreToolUse) {
      return false;
    }

    // Check if workflow hook is present
    return settings.hooks.PreToolUse.some(
      matcher => matcher.hooks.some(h => h.command.includes('workflow_enforcer'))
    );
  } catch (e) {
    console.error('[HookService] Error checking installation:', e);
    return false;
  }
}

/**
 * Sync workflow hooks based on enabled state
 * Instead of installing/uninstalling, we now write a config file
 * that the hook reads to determine if it should enforce or not.
 */
// ============================================
// Reindex Hooks (DeltaCodeCube)
// ============================================

/**
 * Generate a Python script for PostToolUse reindex trigger.
 * Fire-and-forget: uses subprocess.Popen so it doesn't block the agent.
 */
export function generateReindexHookScript(agentcockpitPath: string): string {
  return reindexTriggerTemplate.replace('{{AGENTCOCKPIT_PATH}}', agentcockpitPath);
}

/**
 * Install reindex hooks into a project
 */
export async function installReindexHooks(
  projectPath: string,
  agentcockpitPath: string
): Promise<HookResult> {
  try {
    // 1. Ensure .claude/hooks directory exists
    const hooksDir = `${projectPath}/.claude/hooks`;
    const hooksDirExists = await exists(hooksDir);
    if (!hooksDirExists) {
      await mkdir(hooksDir, { recursive: true });
    }

    // 2. Write reindex hook script
    const hookPath = `${hooksDir}/reindex_trigger.py`;
    const hookScript = generateReindexHookScript(agentcockpitPath);
    await writeTextFile(hookPath, hookScript);

    // 3. Add PostToolUse hook to settings
    let settings = await readClaudeSettings(projectPath) || {};

    if (!settings.hooks) {
      settings.hooks = {};
    }

    const reindexHook: ClaudeHookConfig = {
      type: 'command',
      command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/reindex_trigger.py"`,
      timeout: 3
    };

    const reindexMatcher: ClaudeHookMatcher = {
      matcher: 'Write|Edit|MultiEdit',
      hooks: [reindexHook]
    };

    // Filter out previous reindex hooks
    const existingPostToolUse = (settings.hooks.PostToolUse || []).filter(
      matcher => !matcher.hooks.some(h => h.command.includes('reindex_trigger'))
    );

    settings.hooks.PostToolUse = [...existingPostToolUse, reindexMatcher];

    const success = await writeClaudeSettings(projectPath, settings);
    if (!success) {
      return { success: false, error: 'Failed to write settings.json' };
    }

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[HookService] Reindex install error:', error);
    return { success: false, error };
  }
}

/**
 * Uninstall reindex hooks from a project
 */
export async function uninstallReindexHooks(projectPath: string): Promise<HookResult> {
  try {
    const settings = await readClaudeSettings(projectPath);

    if (settings && settings.hooks) {
      if (settings.hooks.PostToolUse) {
        settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
          matcher => !matcher.hooks.some(h => h.command.includes('reindex_trigger'))
        );

        if (settings.hooks.PostToolUse.length === 0) {
          delete settings.hooks.PostToolUse;
        }
      }

      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      await writeClaudeSettings(projectPath, settings);
    }

    // Remove hook script
    const hookPath = `${projectPath}/.claude/hooks/reindex_trigger.py`;
    const hookExists = await exists(hookPath);
    if (hookExists) {
      await remove(hookPath);
    }

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[HookService] Reindex uninstall error:', error);
    return { success: false, error };
  }
}

/**
 * Check if reindex hooks are installed in a project
 */
export async function isReindexHooksInstalled(projectPath: string): Promise<boolean> {
  try {
    const settings = await readClaudeSettings(projectPath);
    if (!settings || !settings.hooks || !settings.hooks.PostToolUse) {
      return false;
    }
    return settings.hooks.PostToolUse.some(
      matcher => matcher.hooks.some(h => h.command.includes('reindex_trigger'))
    );
  } catch {
    return false;
  }
}

// ============================================
// AS.md — Autonomous Strategy Injection
// ============================================

/**
 * Returns the content of AS.md (Autonomous Strategy framework)
 */
export function generateAsMarkdown(): string {
  return `<!-- AgentCockpit: This file is required for the workflow manager to function correctly.
     Removing it is not recommended. More info: https://github.com/Rixmerz/agentcockpit -->

# AS — Autonomous Strategy

Before responding to any request, consciously evaluate which strategy is best:

## 1. Does it require structure?

**Direct response** if:
- Knowledge question, explanation, or isolated debug
- Obvious 1-3 line change

**Structure needed** if:
- Feature implementation spanning multiple files
- Refactor with regression risk
- Multi-phase process (complex debugging, analysis, deployment)

## 2. If structure is needed: Plan Mode or Workflow?

**Plan Mode** when:
- The result is new or modified code/files
- Architectural decisions need user approval before execution
- The task is one-off, not recurrent

**Workflow** when:
- The process has well-defined phases (e.g. understand → reproduce → fix → verify)
- It is a recurrent type of work (debugging, code review, feature dev)
- Phase enforcement matters — you must not skip steps

### Why workflows are powerful

Workflows unlock capabilities beyond simple plan mode:

- **Context persistence across very long tasks**: A workflow maintains shared state and context across an entire task set, even when individual sessions would normally lose context. You can resume mid-flow without losing where you left off.
- **Context injection**: Each workflow node can inject specific context (files, instructions, constraints) automatically — you always have exactly the right information for the current phase.
- **Dynamic context injection via DCC (Delta Code Cube)**: DCC tracks code changes in real time and injects relevant diffs and metrics into the workflow context. You always know what changed, when, and how much — no manual diffing needed.
- **Memory injections for edits**: Valuable patterns, past mistakes, and project-specific conventions are injected as memory at the right moment, so each edit benefits from accumulated project knowledge.

These advantages make workflows the right choice for any multi-step process where quality, traceability, or context depth matters.

## 3. If Workflow: Reuse or Create?

First list available workflows using the workflow manager tool.

**Reuse** if one already covers the case (e.g. \`debug\` for bugs, \`feature-dev\` for features).

**Create a new one** if the process is unique to this project. Use \`/pipeline-manager-init\` to build it interactively.

## 4. Action

- **Direct response**: Just respond.
- **Plan mode**: Say "entering plan mode" and use EnterPlanMode.
- **Existing workflow**: Activate it and proceed through its phases.
- **New workflow**: Create it first, then activate it.

> This decision is yours. Do not ask the user which to prefer unless you genuinely cannot decide.

---

## 5. Code Editing — LSP First (Mandatory)

Before making any code edit, **always** use LSP tools to understand the target:

- \`LSP hover\` — check the type/signature of the symbol you're about to modify
- \`LSP definition\` — navigate to the definition if you haven't read it yet
- \`LSP references\` — check what else uses this symbol before changing it
- \`LSP diagnostics\` — verify no existing errors before and after the edit

**Never edit code blindly.** If LSP tools are unavailable, read the full file and any direct dependencies before editing.

---

## 6. Pipeline Execution — No Interruptions (Mandatory)

Once a workflow or pipeline is activated, **execute ALL phases to completion without stopping**.

- Do not pause to ask for confirmation between phases
- Do not wait for user input mid-pipeline unless a phase explicitly requires it
- If the user sends a message during execution, acknowledge it briefly and **continue the pipeline**
- Treat intermediate messages as non-blocking comments, not new instructions

**Only stop the pipeline if the user explicitly says:** \`"cancel pipeline"\`, \`"stop workflow"\`, or \`"abort"\`.

Stopping a pipeline mid-way leaves the project in an inconsistent state. Completion is the only acceptable outcome.
`;
}

/**
 * Install AS.md into the user's project and reference it from CLAUDE.md
 */
export async function installAsMarkdown(projectPath: string): Promise<void> {
  try {
    // 1. Ensure .claude directory exists
    const claudeDir = `${projectPath}/.claude`;
    const claudeDirExists = await exists(claudeDir);
    if (!claudeDirExists) {
      await mkdir(claudeDir, { recursive: true });
    }

    // 2. Write AS.md
    const asPath = `${claudeDir}/AS.md`;
    await writeTextFile(asPath, generateAsMarkdown());

    // 3. Update CLAUDE.md
    const claudeMdPath = `${projectPath}/CLAUDE.md`;
    const claudeMdExists = await exists(claudeMdPath);
    const reference = '@.claude/AS.md';
    const prefix = `<!-- AgentCockpit workflow manager — do not remove this line -->\n${reference}\n`;

    if (claudeMdExists) {
      const content = await readTextFile(claudeMdPath);
      if (content.includes(reference)) {
        // Already has the reference — idempotent
        return;
      }
      // Prepend reference with blank line separator
      await writeTextFile(claudeMdPath, `${prefix}\n${content}`);
    } else {
      // Create minimal CLAUDE.md
      await writeTextFile(claudeMdPath, prefix);
    }
  } catch (e) {
    console.error('[HookService] installAsMarkdown error:', e);
  }
}

// ============================================
// Project Defaults Setup
// ============================================

// Bundled file contents — no filesystem reads needed at runtime
const BUNDLED_RULES: Record<string, string> = {
  'autonomous-strategy.md': ruleAutonomousStrategy,
  'workflow-discipline.md': ruleWorkflowDiscipline,
  'subagent-delegation.md': ruleSubagentDelegation,
  'quality-feedback.md': ruleQualityFeedback,
  'commit-discipline.md': ruleCommitDiscipline,
  'execution-philosophy.md': ruleExecutionPhilosophy,
};

const BUNDLED_HOOKS: Record<string, string> = {
  'rules_checker.py': rulesCheckerPy,
  'experience_recorder.py': experienceRecorderPy,
  'experience_injector.py': experienceInjectorPy,
  'memory_injector.py': memoryInjectorPy,
  '_common.py': commonPy,
};

const BUNDLED_COMMANDS: Record<string, string> = {
  'setup-agents.md': commandSetupAgents,
};

/**
 * Write bundled content to dst only if dst does not already exist.
 * Returns true if the file was written, false if skipped.
 */
async function writeIfAbsent(dst: string, content: string): Promise<boolean> {
  const dstExists = await exists(dst);
  if (dstExists) return false;
  await writeTextFile(dst, content);
  return true;
}

/**
 * Setup AgentCockpit defaults for a new project.
 * Copies behavioral rules, hooks, and commands to the project's .claude/ directory.
 * Idempotent — safe to call multiple times (won't overwrite existing files).
 */
export async function setupProjectDefaults(projectPath: string): Promise<HookResult> {
  try {
    // Ensure target directories exist
    const rulesDir = `${projectPath}/.claude/rules`;
    const hooksDir = `${projectPath}/.claude/hooks`;
    const commandsDir = `${projectPath}/.claude/commands`;

    for (const dir of [rulesDir, hooksDir, commandsDir]) {
      const dirExists = await exists(dir);
      if (!dirExists) {
        await mkdir(dir, { recursive: true });
      }
    }

    // Write bundled rules (embedded at build time — no filesystem reads)
    for (const [file, content] of Object.entries(BUNDLED_RULES)) {
      try {
        await writeIfAbsent(`${rulesDir}/${file}`, content);
      } catch (e) {
        console.warn(`[HookService] Could not write rule ${file}:`, e);
      }
    }

    // Write dcc_feedback.py with template replacement
    const dccDst = `${hooksDir}/dcc_feedback.py`;
    const dccDstExists = await exists(dccDst);
    if (!dccDstExists) {
      const dccContent = dccFeedbackTemplate.replace(/\{\{PROJECT_PATH\}\}/g, projectPath);
      await writeTextFile(dccDst, dccContent);
    }

    // Write bundled hooks
    for (const [file, content] of Object.entries(BUNDLED_HOOKS)) {
      try {
        await writeIfAbsent(`${hooksDir}/${file}`, content);
      } catch (e) {
        console.warn(`[HookService] Could not write hook ${file}:`, e);
      }
    }

    // Write bundled commands
    for (const [file, content] of Object.entries(BUNDLED_COMMANDS)) {
      try {
        await writeIfAbsent(`${commandsDir}/${file}`, content);
      } catch (e) {
        console.warn(`[HookService] Could not write command ${file}:`, e);
      }
    }

    // Register hooks in settings.json
    let settings = await readClaudeSettings(projectPath) || {};
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // PostToolUse hooks to add
    const postToolUseToAdd: ClaudeHookMatcher[] = [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/rules_checker.py"`, timeout: 5 }],
      },
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/dcc_feedback.py"`, timeout: 5 }],
      },
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/experience_recorder.py"`, timeout: 5 }],
      },
    ];

    // PreToolUse hooks to add
    const preToolUseToAdd: ClaudeHookMatcher[] = [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/experience_injector.py"`, timeout: 3 }],
      },
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/memory_injector.py"`, timeout: 3 }],
      },
    ];

    // Add PostToolUse hooks (skip duplicates by command)
    const existingPost = settings.hooks.PostToolUse || [];
    const existingPostCommands = new Set(existingPost.flatMap(m => m.hooks.map(h => h.command)));
    for (const matcher of postToolUseToAdd) {
      const cmd = matcher.hooks[0].command;
      if (!existingPostCommands.has(cmd)) {
        existingPost.push(matcher);
        existingPostCommands.add(cmd);
      }
    }
    settings.hooks.PostToolUse = existingPost;

    // Add PreToolUse hooks (skip duplicates by command)
    const existingPre = settings.hooks.PreToolUse || [];
    const existingPreCommands = new Set(existingPre.flatMap(m => m.hooks.map(h => h.command)));
    for (const matcher of preToolUseToAdd) {
      const cmd = matcher.hooks[0].command;
      if (!existingPreCommands.has(cmd)) {
        existingPre.push(matcher);
        existingPreCommands.add(cmd);
      }
    }
    settings.hooks.PreToolUse = existingPre;

    const success = await writeClaudeSettings(projectPath, settings);
    if (!success) {
      return { success: false, error: 'Failed to write settings.json' };
    }

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[HookService] setupProjectDefaults error:', error);
    return { success: false, error };
  }
}

export async function syncWorkflowHooks(
  projectPath: string,
  enabled: boolean,
  steps: WorkflowStep[]
): Promise<HookResult> {
  try {
    // Ensure hooks are installed first (if not already)
    const isInstalled = await isWorkflowHooksInstalled(projectPath);
    if (!isInstalled && enabled) {
      // First time enabling - do full install
      return await installWorkflowHooks(projectPath, steps);
    }

    // Write config.json with enforcer_enabled flag
    const workflowDir = `${projectPath}/.claude/workflow`;
    const configPath = `${workflowDir}/config.json`;

    // Ensure workflow directory exists
    const dirExists = await exists(workflowDir);
    if (!dirExists) {
      await mkdir(workflowDir, { recursive: true });
    }

    // Read existing config or create new
    let config: Record<string, unknown> = {};
    const configExists = await exists(configPath);
    if (configExists) {
      try {
        const content = await readTextFile(configPath);
        config = JSON.parse(content);
      } catch {
        config = {};
      }
    }

    // Update enforcer_enabled flag
    config.enforcer_enabled = enabled;
    config.last_updated = new Date().toISOString();

    await writeTextFile(configPath, JSON.stringify(config, null, 2));

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[HookService] Sync error:', error);
    return { success: false, error };
  }
}
