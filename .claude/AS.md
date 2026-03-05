<!-- AgentCockpit: This file is required for the workflow manager to function correctly.
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

**Reuse** if one already covers the case (e.g. `debug` for bugs, `feature-dev` for features).

**Create a new one** if the process is unique to this project. Use `/pipeline-manager-init` to build it interactively.

## 4. Action

- **Direct response**: Just respond.
- **Plan mode**: Say "entering plan mode" and use EnterPlanMode.
- **Existing workflow**: Activate it and proceed through its phases.
- **New workflow**: Create it first, then activate it.

> This decision is yours. Do not ask the user which to prefer unless you genuinely cannot decide.
