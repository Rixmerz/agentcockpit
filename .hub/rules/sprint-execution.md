# Sprint Execution

> Always structure multi-step tasks as wave-based sprints following these rules.

Rules for executing multi-step development tasks using wave-based parallelization.

## Workflow First
- For any task with 3+ distinct implementation steps, create a workflow graph before starting
- Use `graph_builder_create` to define waves based on dependency analysis
- Each wave groups tasks that can execute in parallel
- Dependencies between waves must be explicit (domain before handlers, backend before frontend, implementation before tests)

## Wave Structure
- **Wave N (Domain/Foundation)**: Core types, models, database changes — no external dependencies
- **Wave N+1 (Backend)**: Handlers, endpoints, wiring — depends on domain
- **Wave N+2 (Frontend)**: Types, hooks, pages, navigation — depends on backend API
- **Wave N+3 (Tests)**: Unit and integration tests — depends on implementation
- **Validate**: Build checks, test suites, architecture review — depends on all waves
- **Docs**: Status updates, changelogs, README — depends on validation

## Execution Rules
- Main context is the orchestrator — delegate all implementation to specialized subagents
- Launch all agents within a wave concurrently with `run_in_background: true`
- Never launch agents that write to the same files in the same wave
- If an agent fails or hits rate limits, complete its work directly in the main context
- After all agents in a wave complete, verify their output before advancing to the next wave

## Agent Prompts
- Give each subagent a complete, self-contained prompt with:
  - Exact file paths to create or modify
  - Reference files to read for patterns (keep minimal — use pattern catalog if available)
  - Acceptance criteria (what "done" looks like)
  - Constraints (what NOT to do)
- Never assume agents share context — each gets a fresh window

## Quality Gates
- Do not commit until the Validate wave passes
- If DCC reports new high/critical smells in the Validate wave, fix before committing
- Architecture review criteria should come from project CLAUDE.md, not invented ad-hoc
