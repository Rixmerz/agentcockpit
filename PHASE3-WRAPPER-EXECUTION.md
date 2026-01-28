# Phase 3: Full Wrapper Execution Logic

## Overview

Phase 3 implements the complete lifecycle for executing integrations as wrapper nodes in the pipeline.

**Architecture:**
```
Integration Node Reached
    ↓
[1] Validate Integration (check installed)
    ↓
[2] Get Manifest (metadata: agents, skills, hooks)
    ↓
[3] PAUSE AgentCockpit Hooks (save current, clear PreToolUse/PostToolUse)
    ↓
[4] Execute Entry Skill (/agentful-start with context)
    ↓
    ╔═══════════════════════════════════════════════════════╗
    ║  Integration Takes Control                           ║
    ║  - Hooks: PreToolUse, PostToolUse active             ║
    ║  - Claude Code: Executes Agentful agents            ║
    ║  - Parallel: Backend, Frontend, Tester in parallel   ║
    ╚═══════════════════════════════════════════════════════╝
    ↓
[5] Monitor for Exit Signal (AGENTFUL_COMPLETE)
    ↓
[6] RESUME AgentCockpit Hooks (restore saved state)
    ↓
Next Node (if exit signal detected)
```

## Services

### 1. `hookPauseResumeService.ts`

Manages pause/resume of AgentCockpit hooks:

```typescript
// Pause hooks before integration execution
const pauseResult = await hookPauseResumeService.pauseAgentCockpitHooks(
  '/path/to/project',
  'agentful'
);

// Resume hooks after integration completes
const resumeResult = await hookPauseResumeService.resumeAgentCockpitHooks(
  '/path/to/project'
);

// Emergency recovery if integration crashes
const forceResult = await hookPauseResumeService.forceResume(
  '/path/to/project'
);

// Check current state
const state = hookPauseResumeService.getPauseState();
// { paused: true, pausedAt: '...', integration: 'agentful' }
```

**Implementation Details:**
- Reads `.claude/settings.json`
- Saves current hooks in memory
- Clears `PreToolUse`, `PostToolUse`, `UserPromptSubmit`
- Adds marker `_agentcockpit_hooks_paused`
- On resume: restores saved hooks
- Force resume: clears pause marker and enables hooks

### 2. `skillExecutionService.ts`

Executes skills with context injection:

```typescript
// Execute /agentful-start with context
const result = await skillExecutionService.executeSkill({
  skillName: '/agentful-start',
  projectPath: '/path/to/project',
  currentTask: 'Build Deno Fresh website',
  variables: {
    plan: '...',
    stack: 'deno-fresh-2.2',
    analysis: '...'
  }
});

// Specific helper for Agentful
const agentfulResult = await skillExecutionService.executeAgentfulStart({
  projectPath: '/path/to/project',
  plan: '...',
  stack: 'deno-fresh',
  task: 'Build components'
});

// Monitor output for exit signal
const signalResult = await skillExecutionService.monitorForExitSignal(
  output,
  'AGENTFUL_COMPLETE',
  45 * 60 * 1000  // 45 minute timeout
);
```

### 3. `phase3WrapperExecutor.ts`

Orchestrates complete wrapper execution:

```typescript
const result = await phase3WrapperExecutor.executeWrapper({
  projectPath: '/path/to/project',
  integrationId: 'agentful',
  entrySkill: '/agentful-start',
  exitSignal: 'AGENTFUL_COMPLETE',
  timeoutMinutes: 45,
  fallbackEdge: 'manual-override',
  context: {
    integrationId: 'agentful',
    projectPath: '/path/to/project',
    currentTask: 'Build website',
    variables: { plan: '...', stack: 'deno-fresh' }
  }
});

// Result:
// {
//   success: true,
//   integrationId: 'agentful',
//   exitSignal: 'AGENTFUL_COMPLETE',
//   duration: 245000,  // ms
//   stages: ['validation', 'manifest', 'pause-hooks', 'execute-skill', 'monitor-signal', 'resume-hooks', 'complete']
// }

// Log summary
phase3WrapperExecutor.logSummary(result);
```

## Execution Flow

### Stage 1: Validation
```
Check: Is 'agentful' installed?
  ✓ Yes → Continue to Stage 2
  ✗ No → Return error, trigger fallback edge
```

### Stage 2: Get Manifest
```
Read: ~/.agentcockpit/integrations/agentful/manifest.json
  ✓ Found → Has metadata (agents, skills, hooks)
  ✗ Not found → Return error, trigger fallback edge
```

### Stage 3: Pause AgentCockpit Hooks
```
Read: /path/to/project/.claude/settings.json
Save: Keep copy in memory
Clear: PreToolUse = []
Clear: PostToolUse = []
Write: Updated settings.json with pause marker
  ✓ Success → Continue to Stage 4
  ✗ Failure → Resume and return error
```

### Stage 4: Execute Entry Skill
```
Skill: /agentful-start
Context: {task, plan, stack, variables}
  ✓ Execution started → Continue to Stage 5
  ✗ Execution failed → Resume hooks and return error
```

**What Happens Inside Agentful:**
- Claude receives prompt with /agentful-start instruction
- Agentful hooks intercept tool calls (PreToolUse, PostToolUse)
- Orchestrator agent coordinates parallel execution:
  - Backend agent: Creates `/routes/api/*`
  - Frontend agent: Creates `/islands/*` and routes
  - Tester agent: Creates tests in `/tests/*`
  - Reviewer agent: Reviews code
  - Others: Architectural decisions, product analysis

### Stage 5: Monitor Exit Signal
```
Watch output for: "AGENTFUL_COMPLETE"
Timeout: 45 minutes (configurable per node)

Loop:
  Check if output contains "AGENTFUL_COMPLETE"
    ✓ Found → Signal detected, continue to Stage 6
    ✗ Not found → Check timeout
      - Time remaining: Keep checking
      - Timeout exceeded: Return error, trigger fallback
```

### Stage 6: Resume AgentCockpit Hooks
```
Restore: /path/to/project/.claude/settings.json from saved copy
Remove: Pause marker (_agentcockpit_hooks_paused)
Write: Settings
  ✓ Success → Continue to completion
  ✗ Failure → Log but continue (we got exit signal)
```

### Stage 7: Complete
```
Return to Pipeline Engine
Exit Signal: "AGENTFUL_COMPLETE"
Next Edge: Condition matches, transits to next node
```

## Error Handling

### Validation Failed
```
Integration not installed
  → Return error
  → No hooks were modified
  → Trigger fallback_edge or manual-override
```

### Hook Pause Failed
```
Could not write settings.json
  → Return error
  → Hooks remain unchanged (AgentCockpit still active)
  → No execution attempted
```

### Execution Failed
```
Skill execution error
  → Attempt to resume hooks
  → If resume fails, log error but don't crash
  → Return error, trigger fallback
```

### Timeout Exceeded
```
No exit signal after 45 minutes
  → Attempt to resume hooks (emergency)
  → Return error with "needs manual override"
  → Pipeline offers fallback_edge option
```

### Integration Crashes
```
Hooks left in paused state
  → ForceResume mechanism:
    - If saved hooks exist: restore them
    - Otherwise: clear pause marker and re-enable
    - Ensures AgentCockpit always recovers
```

## Data Flow

### Input Context
```json
{
  "projectPath": "/path/to/project",
  "integrationId": "agentful",
  "entrySkill": "/agentful-start",
  "exitSignal": "AGENTFUL_COMPLETE",
  "timeoutMinutes": 45,
  "context": {
    "currentTask": "Build Deno Fresh website",
    "variables": {
      "plan": "Detailed implementation plan from planning node",
      "analysis": "Web page analysis from web-analysis node",
      "stack": "deno-fresh-2.2",
      "requirements": "User requirements from url-capture node"
    }
  }
}
```

### Integration Internal State
```
Agentful State (.agentful/):
├── orchestrator.state.json      # Parallel execution state
├── backend.state.json            # Backend agent state
├── frontend.state.json           # Frontend agent state
├── tester.state.json             # Test results
├── reviewer.state.json           # Code review checkpoints
└── output.log                    # Execution log with exit signal

Claude Code Hook State:
├── PreToolUse: [agentful-protect-backend, ...]
├── PostToolUse: [agentful-log-result, ...]
└── UserPromptSubmit: [agentful-validate, ...]
```

### Output Context
```json
{
  "success": true,
  "integrationId": "agentful",
  "exitSignal": "AGENTFUL_COMPLETE",
  "duration": 245000,
  "stages": [
    "validation",
    "manifest",
    "pause-hooks",
    "execute-skill",
    "monitor-signal",
    "resume-hooks",
    "complete"
  ],
  "output": "...(skill execution output)..."
}
```

## Testing Phase 3

### Unit Tests
```typescript
// Test hook pause
const pauseResult = await hookPauseResumeService.pauseAgentCockpitHooks(
  projectPath, 'agentful'
);
assert(pauseResult.success === true);
assert(pauseState.currentlyPaused === true);

// Test hook resume
const resumeResult = await hookPauseResumeService.resumeAgentCockpitHooks(projectPath);
assert(resumeResult.success === true);
assert(pauseState.currentlyPaused === false);

// Test skill execution
const skillResult = await skillExecutionService.executeSkill({
  skillName: '/agentful-start',
  projectPath,
  currentTask: 'test',
  variables: {}
});
assert(skillResult.success === true);
```

### Integration Tests
```typescript
// Test full wrapper execution (mock Agentful)
const result = await phase3WrapperExecutor.executeWrapper({
  projectPath: '/test/project',
  integrationId: 'agentful',
  entrySkill: '/agentful-start',
  exitSignal: 'TEST_COMPLETE',
  timeoutMinutes: 1,
  context: { /* ... */ }
});
assert(result.success === true);
assert(result.stages.length >= 5);
```

### End-to-End Test (With Real Agentful)
```typescript
// Activate hybrid pipeline
await pipelineEngine.activateGraph('hybrid-denofresh-agentful-graph');

// Start pipeline
const result = await pipelineEngine.execute({
  projectPath: '/my/project',
  userInput: 'Build https://example.com with Deno Fresh'
});

// Should flow:
// url-capture → web-analysis → planning → [AGENTFUL WRAPPER] → ui-review → final-validation
// With AgentCockpit hooks paused/resumed correctly during Agentful phase
```

## Next Steps (Phase 4)

Phase 4 will add:
1. **Real Skill System**: Integrate with actual .claude/skills/
2. **MCP Integration**: Call skills via MCP
3. **State Persistence**: Save wrapper state for recovery
4. **Logging & Monitoring**: Detailed execution logs
5. **Production Testing**: With real Agentful integration

## Status

✅ Phase 1: Marketplace registry
✅ Phase 2: Wrapper infrastructure
✅ Phase 3: Full execution logic (THIS)
⏳ Phase 4: MCP integration and production

See also:
- `src/services/hookPauseResumeService.ts`
- `src/services/skillExecutionService.ts`
- `src/services/phase3WrapperExecutor.ts`
- `PHASE2-INTEGRATION-WRAPPER.md`
