---
name: agentful-start
description: Start Agentful parallel agent orchestration with current task context
user-invocable: false
---

# Agentful Start Skill

Initiates Agentful parallel agent orchestration for the current task.

## Purpose

Entry point for Agentful integration node. Orchestrates parallel execution of:
- Backend agent: API routes and data models
- Frontend agent: UI components and pages
- Tester agent: Unit and integration tests
- Reviewer agent: Code quality and standards
- Fixer agent: Bug fixes and optimizations
- Architect agent: Technical decisions
- Product-analyzer agent: Requirements analysis
- Orchestrator agent: Coordination and flow

## Context Injection

This skill receives context from the pipeline via environment variables and arguments:

```json
{
  "projectPath": "/path/to/project",
  "currentTask": "Build Deno Fresh website from design",
  "variables": {
    "plan": "Detailed implementation plan from planning node",
    "analysis": "Web page structure from analysis node",
    "stack": "deno-fresh-2.2",
    "requirements": "User requirements"
  }
}
```

## Execution

### Stage 1: Initialize
- Validate project structure
- Load context variables
- Initialize Agentful orchestrator (.agentful/state.json)
- Mark execution as started

### Stage 2: Spawn Parallel Agents
Agentful spawns these agents in parallel:

1. **Orchestrator Agent** (Coordinator)
   - Manages overall flow
   - Monitors parallel execution
   - Detects completion

2. **Backend Agent**
   - Creates `/routes/api/*` endpoints
   - Implements data models
   - Sets up database connections

3. **Frontend Agent**
   - Creates `/islands/*` interactive components
   - Implements page routes
   - Handles client-side logic

4. **Tester Agent**
   - Writes unit tests for Backend
   - Writes component tests for Frontend
   - Integration test suite

5. **Reviewer Agent**
   - Reviews Backend code
   - Reviews Frontend components
   - Code quality checks

6. **Fixer Agent**
   - Fixes issues found by Reviewer
   - Optimizes performance
   - Refactors as needed

7. **Architect Agent**
   - Makes architectural decisions
   - Ensures consistency
   - Tech stack alignment

8. **Product-Analyzer Agent**
   - Ensures requirements met
   - User experience validation
   - Feature completeness check

### Stage 3: Monitor Execution
- Watch for agent completion
- Aggregate results
- Track errors
- Update .agentful/execution.log

### Stage 4: Emit Exit Signal
When all agents complete successfully:

```
AGENTFUL_COMPLETE

Execution Summary:
- Backend: ✓ {N} endpoints created
- Frontend: ✓ {N} components created
- Tests: ✓ {N} tests written
- Review: ✓ {N} issues fixed
- Architecture: ✓ Validated
- Product: ✓ Requirements met
```

## Output Format

The skill MUST emit the exact phrase: **`AGENTFUL_COMPLETE`**

This triggers the pipeline exit signal detection and transitions to the next node.

## Exit Conditions

**Success:** Emit `AGENTFUL_COMPLETE` + summary

**Failure:**
- Emit error description
- Do NOT emit `AGENTFUL_COMPLETE`
- Pipeline will timeout and fallback

## State Files

Creates in project:
```
.agentful/
├── orchestrator.state.json      # Main orchestration state
├── backend.state.json            # Backend progress
├── frontend.state.json           # Frontend progress
├── tester.state.json             # Test results
├── reviewer.state.json           # Code review log
├── fixer.state.json              # Bug fixes log
├── architect.state.json          # Technical decisions
├── product-analyzer.state.json   # Requirements validation
└── execution.log                 # Detailed execution log
```

## Hooks Active During Execution

Agentful activates these protective hooks:
- `PreToolUse`: Validate tool calls before execution
- `PostToolUse`: Log and verify tool results
- `UserPromptSubmit`: Coordinate multi-agent prompts

AgentCockpit hooks are PAUSED during this skill execution.

## Timeout

Default: 45 minutes (configurable per pipeline node)

If not completed within timeout:
- Agents are forcefully stopped
- Emit timeout error
- Pipeline triggers fallback edge

## Recovery

If execution fails:
1. Agentful saves state to .agentful/
2. Hooks are resumed
3. User can manually debug or fallback
4. ForceResume ensures AgentCockpit control restored

## Notes

- This skill is NOT user-invocable (only via integration node)
- Requires Agentful to be installed: `npm install @itz4blitz/agentful`
- Requires Agentful to be enabled for project: `npx @itz4blitz/agentful init`
- Must run within integration node wrapper (hooks pause/resume)
- Parallel agents coordinate via Agentful's internal protocol
