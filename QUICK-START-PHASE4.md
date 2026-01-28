# Quick Start: Phase 4 - Production Integration

## What's Already Done ✅

Phases 1-3 are complete:
- ✅ Marketplace registry (install/uninstall integractions)
- ✅ Wrapper infrastructure (integration nodes in pipelines)
- ✅ Full execution logic (hook pause/resume, skill execution)
- ✅ Example hybrid pipeline with Agentful integration node

**Status:** Ready for Phase 4 implementation

## Phase 4 Roadmap

### Goals
1. **MCP Integration**: Call real skills via MCP (Model Context Protocol)
2. **State Persistence**: Save/load wrapper execution state
3. **Production Testing**: Test with actual Agentful integration
4. **Monitoring & Logging**: Enhanced execution visibility
5. **Error Recovery**: Graceful error handling and recovery

### Key Files to Modify

#### 1. `skillExecutionService.ts`
Current: Placeholder for skill execution

```typescript
// TODO Phase 4: Actual MCP skill invocation
async executeSkill(context: SkillContext): Promise<SkillExecutionResult> {
  // Real implementation:
  // 1. Check if skill exists in .claude/skills/{skillName}.md
  // 2. Load skill definition
  // 3. Inject context into skill
  // 4. Call MCP skill execution
  // 5. Stream output
  // 6. Return result
}
```

#### 2. `integrationWrapperService.ts`
Current: Mostly placeholders

```typescript
// TODO Phase 4: Real wrapper execution
async executeWrapper(context, entrySkill, exitSignal, timeoutMinutes) {
  // Current: Calls integrationWrapperService methods
  // Phase 4: Should use phase3WrapperExecutor.executeWrapper()
}
```

#### 3. New: `wrapperStateService.ts`
```typescript
// Phase 4 new service: Persist wrapper state
export const wrapperStateService = {
  // Save state during execution
  async saveState(executionId, state),

  // Load state for recovery
  async loadState(executionId),

  // List active executions
  async listActiveExecutions()
};
```

### Implementation Steps

#### Step 1: Create MCP Skill Executor
```typescript
// services/mcpSkillExecutor.ts
export async function executeMcpSkill(skillName: string, context: any) {
  // Use @tauri-apps/plugin-mcp to call skill
  // Stream output to monitor
  // Return result
}
```

#### Step 2: Update skillExecutionService
```typescript
// Replace placeholder with real MCP execution
const output = await executeMcpSkill(
  context.skillName,
  context
);
```

#### Step 3: Create Wrapper State Persistence
```typescript
// services/wrapperStateService.ts
export const wrapperStateService = {
  async saveState(executionId, state) {
    // Save to ~/.agentcockpit/executions/{executionId}/state.json
  },
  async loadState(executionId) {
    // Load from above path
  }
};
```

#### Step 4: Update phase3WrapperExecutor
```typescript
// Before executing:
await wrapperStateService.saveState(executionId, {
  stage: 'started',
  integration: 'agentful',
  timestamp: new Date()
});

// During execution, persist stage updates
for (const stage of stages) {
  await wrapperStateService.updateStage(executionId, stage);
}

// On error, save error state for recovery
await wrapperStateService.saveState(executionId, {
  stage: 'failed',
  error: error.message
});
```

#### Step 5: Test with Hybrid Pipeline
```typescript
// Test hybrid-denofresh-agentful-graph.yaml
import { pipelineEngine } from './services/pipelineService';

const result = await pipelineEngine.executeGraph({
  graphName: 'hybrid-denofresh-agentful-graph',
  projectPath: '/test/project',
  userInput: 'Build https://example.com'
});

// Should flow through all phases correctly
// With hooks paused/resumed during Agentful phase
```

## Integration Checklist

Before Phase 4 implementation:
- [ ] Verify @tauri-apps/plugin-mcp is available
- [ ] Check if skills are MCP-callable or need wrapper
- [ ] Understand Agentful's MCP interface (if any)
- [ ] Plan state persistence location (~/.agentcockpit/executions/)
- [ ] Design monitoring/logging format

## Testing Strategy

### Unit Tests
```typescript
describe('Phase 4: Production Integration', () => {
  test('MCP skill execution', async () => {
    // Mock MCP
    // Execute skill
    // Check output
  });

  test('State persistence', async () => {
    // Save state
    // Load state
    // Verify exact match
  });

  test('Hook pause/resume with MCP', async () => {
    // Execute with real skill
    // Verify hooks paused/resumed
  });
});
```

### Integration Tests
```typescript
describe('Full Wrapper Execution', () => {
  test('Hybrid pipeline with Agentful', async () => {
    // Activate hybrid-denofresh-agentful-graph
    // Execute with test input
    // Verify all phases completed
    // Check exit signal received
  });

  test('Error recovery', async () => {
    // Simulate skill failure
    // Verify hooks recovered
    // Verify state saved
  });
});
```

### End-to-End Test
```typescript
describe('Production Readiness', () => {
  test('Real Agentful integration', async () => {
    // Install Agentful from npm
    // Enable for project
    // Run hybrid pipeline
    // Verify output quality
    // Check parallel agents worked
  });
});
```

## Performance Considerations

- [ ] Skill execution timeout: 45 minutes (configurable)
- [ ] Hook pause/resume: Should be < 100ms
- [ ] State persistence: Incremental saves during execution
- [ ] Memory: Keep only active execution state in memory

## Security Considerations

- [ ] Validate skill names (no path traversal)
- [ ] Validate integration IDs (no path traversal)
- [ ] Don't execute arbitrary commands via MCP
- [ ] Validate context data before passing to skills
- [ ] Log all executions for audit trail

## Documentation

- [ ] Update README with Phase 4 status
- [ ] Document MCP skill interface
- [ ] Create troubleshooting guide
- [ ] Add production deployment guide

## Related PRs/Issues

See:
- Phase 1 commits: Marketplace registry
- Phase 2 commits: Wrapper infrastructure
- Phase 3 commits: Execution logic
- This file: Phase 4 roadmap

## Next: Phase 4 Implementation

Ready to start Phase 4 when:
1. All Phase 1-3 tests pass ✓
2. Hybrid pipeline validates ✓
3. Documentation is clear ✓
4. Team alignment on Phase 4 approach

**Timeline Estimate:** Phase 4 = ~2-3 sprints
- Sprint 1: MCP integration + state persistence
- Sprint 2: Production testing + documentation
- Sprint 3: Performance tuning + security hardening

---

See also:
- `PHASE2-INTEGRATION-WRAPPER.md`
- `PHASE3-WRAPPER-EXECUTION.md`
- `.claude/pipelines/hybrid-denofresh-agentful-graph.yaml`
