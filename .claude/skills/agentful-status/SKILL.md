---
name: agentful-status
description: Check Agentful execution status and agent progress
user-invocable: false
---

# Agentful Status Skill

Checks the current status of Agentful parallel execution.

## Purpose

Monitor progress of Agentful orchestration:
- Agent status (running, completed, failed)
- Completion percentage
- Errors and warnings
- Time elapsed

## Execution

Reads from `.agentful/` state files:

### Check Orchestrator State
```json
{
  "status": "running|completed|failed",
  "startTime": "2026-01-28T...",
  "elapsedSeconds": 245,
  "agentsCompleted": 6,
  "agentsTotal": 8,
  "completionPercent": 75
}
```

### Check Agent Progress
For each agent:
```
Backend Agent:      ✓ 5/5 endpoints
Frontend Agent:     ⟳ 3/8 components (37%)
Tester Agent:       ⟳ 12/15 tests written (80%)
Reviewer Agent:     ✓ All issues reviewed
Fixer Agent:        ⟳ 4/6 fixes applied (66%)
Architect Agent:    ✓ Architecture validated
Product-Analyzer:   ⟳ 8/10 requirements checked (80%)
Orchestrator:       ⟳ Coordinating...
```

### Emit Status

**While Running:**
```
AGENTFUL_STATUS: 75% complete
- Backend: ✓ Complete
- Frontend: 37% complete (3/8)
- Tester: 80% complete (12/15)
- Reviewer: ✓ Complete
- Fixer: 66% complete (4/6)
- Architect: ✓ Complete
- Product-Analyzer: 80% complete (8/10)

Elapsed: 4m 5s | Estimated remaining: 1m 20s
```

**When Complete:**
```
AGENTFUL_COMPLETE

Final Status:
✓ Backend: 5 endpoints created
✓ Frontend: 8 components created
✓ Tests: 15 tests written
✓ Reviewer: All issues fixed
✓ Architecture: Validated
✓ Product: All requirements met

Total time: 5m 24s
```

**On Error:**
```
AGENTFUL_ERROR

Backend Agent: ✗ Failed at endpoint /api/users
Error: Database connection failed
  → Fixer Agent: Attempting fix...

Current Status: 45% complete
Waiting for fix attempt...
```

## Used By

- Phase3Executor's monitoring loop
- Interactive status updates during execution
- Timeout detection

## Notes

- Does NOT block execution (read-only)
- Updates .agentful/status.json in real-time
- Called periodically during skill execution
