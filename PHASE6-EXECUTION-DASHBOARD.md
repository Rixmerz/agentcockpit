# Phase 6: Real-Time Execution Dashboard & Testing

## Status: ✅ IMPLEMENTED (Parts 1-2 of 4)

Phase 6 brings observability and testability to the integration wrapper system with a real-time execution dashboard and comprehensive demo testing framework.

---

## What's New in Phase 6

### 6a. Execution Monitor Dashboard ✅

**ExecutionMonitorPanel.tsx** (13 KB)

Real-time visualization of wrapper execution state with:

- **Execution List**: Shows all recent executions with status, duration, and progress
  - Status indicators: ✅ completed, ❌ failed, ⏳ running, ⏱️ timeout
  - Auto-sorts by newest first
  - Shows execution ID, task, and stage count
  - Click to view detailed execution

- **Real-time Progress**: For running executions
  - Completion percentage
  - Agent-by-agent status grid (Backend, Frontend, Tester, Reviewer, Fixer, Architect, Product-Analyzer, Orchestrator)
  - Time elapsed and estimated remaining
  - Auto-refreshes every 3 seconds

- **Detailed Stages View**: Expandable stages with complete information
  ```
  Stage: skill-execution
  Status: completed
  Timestamp: 02:39:56
  Details: { skill: "/agentful-start", agents: 8, exitSignal: "AGENTFUL_COMPLETE" }
  ```

- **Error Display**: Full error messages if execution fails
- **Output View**: Complete execution output for debugging
- **Auto-refresh**: Polls every 5 seconds for new/updated executions

**Location**: Right sidebar under "AGENTS" tab when Claude plugin is active
**Data Source**: Loads from `wrapperStateService` which persists to `~/.agentcockpit/executions/`

### 6b. Demo Execution Launcher ✅

**DemoExecutionLauncher.tsx** (4.8 KB) + **integrationExecutionDemo.ts** (7.2 KB)

Four demo modes for testing the complete system:

#### Demo 1: Quick Test (1.2 seconds)
```
✓ Validation (200ms)
✓ Manifest (200ms)
✓ Pause Hooks (200ms)
✓ Skill Execution (200ms)
✓ Monitor Signal (200ms)
✓ Resume Hooks (200ms)
---
Total: 1.2s
Perfect for: Rapid validation that system works
```

#### Demo 2: Full Demo (6 seconds)
```
✓ Validation (1s)
✓ Manifest (500ms)
✓ Pause Hooks (500ms)
✓ Skill Execution (3s) ← Runs full Agentful simulation
✓ Monitor Signal (500ms)
✓ Resume Hooks (500ms)
---
Total: 6s
Perfect for: Complete workflow demonstration
Shows: 8 agents completing with endpoints, components, tests created
```

#### Demo 3: Failed Execution
```
✓ Validation (completed)
✓ Manifest (completed)
✓ Pause Hooks (completed)
✗ Skill Execution (FAILED)
  Error: "Skill execution failed: Connection timeout"
---
Perfect for: Testing error handling and recovery UI
Shows: How system displays errors and failed stages
```

#### Demo 4: Timeout Execution
```
✓ Validation (completed)
✓ Manifest (completed)
✓ Pause Hooks (completed)
⏳ Skill Execution (running for 2s, then TIMEOUT)
  Error: "Timeout after 45 minutes"
---
Perfect for: Testing timeout handling
Shows: How system displays timeout states
```

**Location**: Marketplace panel (right sidebar)
**How to Use**:
1. Select a project
2. Open Marketplace
3. Click "Demo Executions" to expand
4. Click any demo option
5. Check Execution Monitor above to see results

---

## Complete Workflow: User Perspective

```
┌─────────────────────────────────────────────────────┐
│ AgentCockpit UI                                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  AGENTS Tab (Right Sidebar)                         │
│  ├─ Execution Monitor [NEW - Phase 6a]             │
│  │  ├─ Recent Executions List                       │
│  │  │  ├─ [Quick Demo] ✅ 1.2s                      │
│  │  │  ├─ [Full Demo]  ✅ 6s                        │
│  │  │  └─ [Your Integration] ⏳ Running             │
│  │  │                                                │
│  │  └─ Detailed View (click any execution)          │
│  │     ├─ Stages with timestamps                    │
│  │     ├─ Live progress for running                 │
│  │     ├─ Error details                             │
│  │     └─ Full output                               │
│  │                                                  │
│  ├─ Marketplace [Updated - Phase 6b]               │
│  │  ├─ Demo Executions [NEW]                       │
│  │  │  ├─ Quick Test (1.2s)                         │
│  │  │  ├─ Full Demo (6s)                            │
│  │  │  ├─ Failed Execution (demo error)             │
│  │  │  └─ Timeout Demo (timeout handling)           │
│  │  │                                                │
│  │  └─ Available Integrations                       │
│  │     └─ Agentful (Install/Enable/Disable)         │
│  │                                                  │
│  └─ [Other panels...]                              │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Testing Workflow

```
1. Open AgentCockpit
2. Select or create a project
3. Go to "AGENTS" tab → "Marketplace"
4. Expand "Demo Executions"
5. Click "Full Demo" button
6. Watch the execution run (~6 seconds)
7. After completion, go to Execution Monitor above
8. Click the execution to see full details:
   - All 6 stages with timestamps
   - Full Agentful output
   - 8 agents (Backend, Frontend, Tester, etc.) completing
   - 5 API endpoints created
   - 8 components created
   - 15 tests written
```

---

## Architecture: How It All Works

### Flow: Demo Execution → State Persistence → Dashboard Display

```
DemoExecutionLauncher (UI)
  ↓ [Click "Full Demo"]
integrationExecutionDemo.fullDemo()
  ↓ [Simulates each stage]
wrapperStateService.createState()
  ↓ [Creates ~/.agentcockpit/executions/exec-{id}/state.json]
wrapperStateService.addStage() [6x for each stage]
  ↓ [Updates state.json for each stage]
agentfulIntegrationService.simulateAgentfulOutput()
  ↓ [Generates realistic 8-agent output]
wrapperStateService.updateOutput()
  ↓ [Saves full output to state]
wrapperStateService.markCompleted()
  ↓ [Sets status: 'completed', exitSignal: 'AGENTFUL_COMPLETE']
ExecutionMonitorPanel (UI)
  ↓ [Queries wrapperStateService.listExecutions()]
  ↓ [Loads and displays newest execution]
  ↓ [Shows stages, output, progress, etc.]
User sees: Complete execution history with full details
```

### State Persistence Structure

```
~/.agentcockpit/executions/
├── exec-1706449032123-abc123def/
│   ├── state.json (execution state)
│   ├── output.log (full output - optional)
│   └── metadata.json (execution metadata - optional)
│
├── exec-1706449045234-def456ghi/
│   └── state.json
│
└── demo-exec-1706450000000-quick/
    └── state.json (from demo execution)
```

### State.json Structure

```json
{
  "executionId": "exec-1706449032123-abc123def",
  "integrationId": "agentful",
  "projectPath": "/path/to/project",
  "task": "Build Full-Stack AI Platform",
  "status": "completed",
  "startTime": "2026-01-28T02:30:32.123Z",
  "endTime": "2026-01-28T02:39:56.456Z",
  "stages": [
    {
      "stage": "validation",
      "timestamp": "2026-01-28T02:30:32.200Z",
      "status": "completed",
      "details": {"integrationId": "agentful"}
    },
    {
      "stage": "manifest",
      "timestamp": "2026-01-28T02:30:33.100Z",
      "status": "completed",
      "details": {"integration": "agentful", "version": "1.0.0"}
    },
    ... (4 more stages)
  ],
  "output": "...[full Agentful output with all agent logs]...",
  "exitSignal": "AGENTFUL_COMPLETE",
  "metadata": {
    "version": "1.0.0",
    "agentcockpitVersion": "3.0.0",
    "integrationVersion": "1.0.0"
  }
}
```

---

## Files Created in Phase 6

### Phase 6a: Execution Dashboard
```
NEW:
├── src/components/marketplace/ExecutionMonitorPanel.tsx (13 KB)
│   └── Real-time execution state visualization
│
└── src/components/marketplace/ExecutionMonitorPanel.css (10 KB)
    └── Professional styling for dashboard
```

### Phase 6b: Demo Testing
```
NEW:
├── src/components/marketplace/DemoExecutionLauncher.tsx (4.8 KB)
│   └── UI for triggering demo executions
│
├── src/components/marketplace/DemoExecutionLauncher.css (3.1 KB)
│   └── Styling for launcher component
│
└── src/services/integrationExecutionDemo.ts (7.2 KB)
    └── Complete demo orchestration system

UPDATED:
└── src/components/marketplace/MarketplacePanel.tsx
    └── Added DemoExecutionLauncher component
```

---

## Quick Start: Test the System Now

### Option 1: Run Demo from UI
```
1. Open AgentCockpit
2. Select a project
3. Go to AGENTS tab → Marketplace
4. Expand "Demo Executions"
5. Click "Quick Test" (1.2s) or "Full Demo" (6s)
6. Check Execution Monitor above for results
```

### Option 2: Run Demo Programmatically (Console)
```typescript
// In browser console or app code:
import { integrationExecutionDemo } from './src/services/integrationExecutionDemo';

// Quick test
await integrationExecutionDemo.quickTest('/path/to/project');

// Full demo
await integrationExecutionDemo.fullDemo('/path/to/project');

// Failed execution demo
await integrationExecutionDemo.failedExecutionDemo('/path/to/project');

// Timeout demo
await integrationExecutionDemo.timeoutExecutionDemo('/path/to/project');
```

### Option 3: Direct Service Call
```typescript
import { wrapperStateService } from './src/services/wrapperStateService';

// List all executions
const executions = await wrapperStateService.listExecutions();
console.log(executions);

// Load specific execution
const state = await wrapperStateService.loadState(executions[0]);
console.log(state);

// Get summary
const summary = await wrapperStateService.getSummary(executions[0]);
console.log(summary);
```

---

## Testing Scenarios

### ✅ Success Path
1. Demo runs through all 6 stages
2. Each stage completes successfully
3. Agentful output shows 8 agents completing
4. Output parsed to show:
   - 5 API endpoints created
   - 8 React components
   - 15 tests written
   - 3 issues fixed

### ❌ Error Path
1. Demo runs through 3 successful stages
2. Skill execution stage fails
3. Error message displayed
4. System shows failed stage with error details
5. Recovery path available

### ⏱️ Timeout Path
1. Demo runs through 3 successful stages
2. Skill execution starts but never completes
3. After 2 seconds, execution marks as timeout
4. UI shows timeout indicator
5. User sees "Timeout after 45 minutes" message

---

## Phase 6 Implementation Status

### ✅ Completed
- [x] Execution Monitor Dashboard (Part 6a)
  - [x] Real-time execution list
  - [x] Detailed stage view
  - [x] Progress tracking
  - [x] Error display
  - [x] Output viewer
  - [x] Auto-refresh polling

- [x] Demo Execution System (Part 6b)
  - [x] Quick test mode
  - [x] Full demo mode
  - [x] Failed execution demo
  - [x] Timeout demo
  - [x] UI launcher component
  - [x] Results display

### ⏳ TODO (Phase 6c+)
- [ ] Real @itz4blitz/agentful package integration (Part 6c)
  - [ ] Replace mock simulation with actual execution
  - [ ] Real agent spawning and execution
  - [ ] Actual file creation and test generation

- [ ] UI Enhancements (Part 6d)
  - [ ] Streaming output in real-time
  - [ ] Live progress updates (WebSocket?)
  - [ ] Execution recovery/retry
  - [ ] Multi-execution management
  - [ ] Execution history export

---

## Integration Points

### ExecutionMonitorPanel connects to:
- ✅ wrapperStateService - loads execution state from disk
- ✅ agentfulIntegrationService - gets progress data
- ✅ Phase 5 state persistence - displays saved lifecycle

### DemoExecutionLauncher connects to:
- ✅ integrationExecutionDemo - orchestrates demo flow
- ✅ wrapperStateService - creates and updates state
- ✅ agentfulIntegrationService - simulates output
- ✅ ExecutionMonitorPanel - results displayed automatically

---

## Summary

**Phase 6 Status: ✅ OBSERVABILITY & TESTABILITY COMPLETE**

The AgentCockpit integration system is now fully observable and testable:

- ✅ Real-time execution dashboard shows all state and progress
- ✅ Four demo modes allow complete system testing
- ✅ State persistence provides complete audit trail
- ✅ User-friendly UI for monitoring and debugging
- ✅ No external dependencies needed for testing

**Next: Phase 6c - Real Agentful Integration**

Replace the mock simulation with the actual @itz4blitz/agentful package for production use.

**See also:**
- `src/components/marketplace/ExecutionMonitorPanel.tsx` - Dashboard UI
- `src/components/marketplace/DemoExecutionLauncher.tsx` - Demo launcher
- `src/services/integrationExecutionDemo.ts` - Demo orchestration
- `PHASE5-STATE-PERSISTENCE.md` - State persistence details
