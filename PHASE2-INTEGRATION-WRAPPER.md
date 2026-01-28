# Phase 2: Integration Wrapper Implementation

## Overview

Phase 2 implements the actual wrapper logic for integration nodes in the pipeline graph.

**Architecture:**
```
Pipeline Graph
    ↓
[Standard Node] → [Integration Node]
                        ↓
                  integrationNodeHandler
                        ↓
                  1. Validate integration
                  2. Build wrapper prompt
                  3. Pause AgentCockpit hooks
                  4. Activate integration hooks
                  5. Execute entry skill
                  6. Monitor exit signal
                  7. Restore AgentCockpit hooks
                        ↓
                  [Next Node (if exit condition met)]
```

## Files Created

### 1. `integrationWrapperService.ts`
Manages the lifecycle of wrapper execution:

```typescript
// Validate integration is installed
const validation = await integrationWrapperService.validateIntegration('agentful');

// Get integration manifest
const manifest = await integrationWrapperService.getIntegrationManifest('agentful');

// Prepare wrapper context with task info
const context = {
  integrationId: 'agentful',
  projectPath: '/path/to/project',
  currentTask: 'Build Deno Fresh site',
  variables: { plan: '...', stack: 'deno-fresh' }
};

// Execute wrapper (currently placeholder, full implementation in Phase 3)
const result = await integrationWrapperService.executeWrapper(
  context,
  '/agentful-start',           // entry skill
  'AGENTFUL_COMPLETE',         // exit signal
  45                           // timeout minutes
);
```

### 2. `integrationNodeHandler.ts`
Handles integration nodes during pipeline execution:

```typescript
// Check if node is integration type
const isIntegration = integrationNodeHandler.isIntegrationNode(node);

// Handle integration node
const result = await integrationNodeHandler.handleIntegrationNode({
  node,
  projectPath: '/path/to/project',
  currentTask: 'Build website',
  nodeVariables: { plan: '...' }
});

// Returns:
// - promptInjection: Instructions for Claude to execute integration
// - exitCondition: Signal to watch for (e.g., 'AGENTFUL_COMPLETE')
// - error: Any validation errors

// Check if output contains exit condition
const hasExited = integrationNodeHandler.checkExitCondition(
  output,
  'AGENTFUL_COMPLETE'
);

// Get next node based on exit signal
const nextNode = integrationNodeHandler.getNextNode(
  'AGENTFUL_COMPLETE',
  'parallel-development',
  edges
);
```

### 3. `hybrid-denofresh-agentful-graph.yaml`
Example pipeline with integration node:

**Structure:**
```
Phase 1 (Sequential, AgentCockpit control):
  url-capture → web-analysis → planning

Phase 2 (Parallel, Agentful control):
  planning → [parallel-development] → (on AGENTFUL_COMPLETE) ui-review

Phase 3 (Sequential, AgentCockpit control):
  ui-review → final-validation
```

**Integration Node Definition:**
```yaml
- id: "parallel-development"
  name: "Parallel Development with Agentful"
  type: "integration"
  integration: "agentful"

  wrapper_config:
    entry_skill: "/agentful-start"
    exit_signal: "AGENTFUL_COMPLETE"
    timeout_minutes: 45
    fallback_edge: "manual-override"
```

**Edge that detects exit condition:**
```yaml
- id: "parallel-to-review"
  from: "parallel-development"
  to: "ui-review"
  condition:
    type: "phrase"
    phrases:
      - "AGENTFUL_COMPLETE"  # Exit signal from integration
  priority: 1
```

## Integration Workflow

### 1. Pipeline Reaches Integration Node
```
[planning] --[auto]--> [parallel-development]
```

### 2. Handler Prepares Integration
- Validates Agentful is installed
- Gets manifest with metadata (agents, skills, hooks)
- Prepares wrapper context with task info
- Builds special prompt injection

### 3. Prompt Injection (What Claude Sees)
```
═══════════════════════════════════════════════════════════════════
INTEGRATION NODE: Parallel Development with Agentful
═══════════════════════════════════════════════════════════════════

Integration: Agentful v1.0.0
Entry Skill: /agentful-start
Exit Condition: AGENTFUL_COMPLETE

CRITICAL INSTRUCTIONS:

1. PAUSE AgentCockpit hooks
   - PreToolUse, PostToolUse will be temporarily disabled
   - Agentful hooks will take control

2. EXECUTE Entry Skill
   You MUST execute this skill: /agentful-start

   Context: {task, variables, etc}

3. DELEGATE TO INTEGRATION
   Agentful will manage:
   - orchestrator
   - backend
   - frontend
   - tester
   - reviewer
   - fixer
   - architect
   - product-analyzer

4. MONITOR FOR EXIT CONDITION
   When you receive: "AGENTFUL_COMPLETE"
   Emit it EXACTLY to trigger next node transition.

5. RESTORE AgentCockpit hooks
   After exit signal, normal control resumes.
```

### 4. Claude Executes /agentful-start
- Agentful hooks (PreToolUse, PostToolUse) intercept tool calls
- Agentful orchestrates parallel agent execution
- Backend, Frontend, Tester work simultaneously
- All protected by Agentful's protective hooks

### 5. Exit Signal Emitted
Agentful outputs: `AGENTFUL_COMPLETE`

### 6. Pipeline Detects Exit
Edge condition matches the phrase "AGENTFUL_COMPLETE"

### 7. Transition to Next Node
```
[parallel-development] --[AGENTFUL_COMPLETE]--> [ui-review]
```

### 8. AgentCockpit Hooks Restored
Normal pipeline control resumes

## Data Flow

### Input to Agentful
```json
{
  "integration": "agentful",
  "project": "/path/to/project",
  "task": "Build Deno Fresh website from design",
  "timestamp": "2026-01-28T...",
  "variables": {
    "plan": "Component architecture...",
    "analysis": "Page structure...",
    "stack": "deno-fresh-2.2"
  }
}
```

### Output from Agentful
- Backend: API routes in `/routes/api/`
- Frontend: Components in `/islands/` and `/routes/`
- Tester: Unit tests in `/tests/`
- Reviewer: Code review checkpoints
- Exit Signal: `AGENTFUL_COMPLETE`

## Hook Pause/Resume Logic (Phase 3)

When entering integration node:
```typescript
// Phase 3 Implementation
hookManager.pauseAgentCockpitHooks(); // Pause PreToolUse, PostToolUse

// Agentful hooks now active via its entry skill
const result = await executeSkill('/agentful-start', wrapperContext);

// Wait for exit signal
while (!result.includes('AGENTFUL_COMPLETE')) {
  // Monitor execution...
}

hookManager.restoreAgentCockpitHooks(); // Restore our control
```

## Error Handling

### Integration Not Installed
```
Node: parallel-development
Error: Integration 'agentful' not installed
Action: Fallback edge → manual-override (if defined)
```

### Timeout Exceeded
```
Node: parallel-development
Timeout: 45 minutes exceeded
Action: Fallback edge → manual-override
```

### Exit Signal Not Received
```
Node: parallel-development
Error: AGENTFUL_COMPLETE not received after timeout
Action: Show user manual override option
```

## Testing Phase 2

### Quick Test
```typescript
// 1. Install Agentful marketplace
const install = await marketplaceService.install('agentful');

// 2. Test integration handler
const result = await integrationNodeHandler.handleIntegrationNode({
  node: {
    id: 'parallel-development',
    name: 'Test',
    type: 'integration',
    integration: 'agentful',
    wrapper_config: {
      entry_skill: '/agentful-start',
      exit_signal: 'AGENTFUL_COMPLETE',
      timeout_minutes: 45
    }
  },
  projectPath: '/test/project',
  currentTask: 'Test build',
  nodeVariables: {}
});

// 3. Check prompt injection was generated
console.log(result.promptInjection);
```

## Phase 3: Full Implementation

Phase 3 will add:
1. **Hook Pause/Resume**: Actual pause/restore of AgentCockpit hooks
2. **Skill Execution**: Execute /agentful-start with context
3. **Exit Signal Monitoring**: Watch output for AGENTFUL_COMPLETE
4. **Timeout Management**: Enforce timeout_minutes, trigger fallback
5. **State Preservation**: Save/restore AgentCockpit state during wrapper

## Related Files
- `src/services/marketplaceService.ts` - Phase 1: Marketplace registry
- `src/services/pipelineService.ts` - Updated GraphNode with integration support
- `src/components/marketplace/MarketplacePanel.tsx` - Phase 1: UI for marketplace
- `.claude/pipelines/hybrid-denofresh-agentful-graph.yaml` - Example pipeline

## Status

- ✅ Phase 1: Marketplace registry complete
- ✅ Phase 2: Wrapper infrastructure (services, handlers, example pipeline)
- ⏳ Phase 3: Full wrapper execution logic
- ⏳ Phase 4: Production testing with real Agentful
