---
name: sprint
description: Create a workflow graph for a development sprint with wave-based parallelization. Use when starting a multi-step implementation task.
disable-model-invocation: true
argument-hint: "[sprint description]"
---

Create a sprint workflow for: $ARGUMENTS

1. Analyze the task and identify all deliverables
2. Group deliverables into dependency-based waves:
   - **Wave 1 (Foundation)**: Domain models, database migrations, core types — no external dependencies
   - **Wave 2 (Backend)**: Handlers, endpoints, wiring — depends on Wave 1
   - **Wave 3 (Frontend)**: UI components, pages, hooks — depends on Wave 2 API
   - **Wave 4 (Tests)**: Unit and integration tests — depends on implementation
   - **Validate**: Build checks, test suites, architecture review
   - **Docs**: Status updates, changelogs, README

3. Create the workflow graph using `graph_builder_create`:
   - One node per wave
   - Edges with phrase conditions between waves
   - `prompt_injection` on each node with exact instructions for subagents

4. Activate the graph with `graph_activate`

5. Present the sprint plan as a table:
   ```
   | Wave | Deliverables | Agents |
   |------|-------------|--------|
   ```

6. Ask for approval before starting execution

Rules:
- Main context is the orchestrator — delegate implementation to specialized subagents
- Launch all agents within a wave concurrently with `run_in_background: true`
- Never launch agents that write to the same files in the same wave
- After all agents in a wave complete, verify output before advancing
