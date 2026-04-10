# Subagent Delegation

> Always apply these delegation rules when deciding whether to use a subagent.

Rules for when and how to use specialized subagents.

## DO
- Use specialized subagents (backend, frontend, tester, reviewer) for domain-specific tasks
- Launch multiple subagents in parallel when tasks are independent (e.g., backend + frontend changes)
- Use `run_in_background: true` for agents whose results you don't need immediately
- Give subagents complete, self-contained prompts — they don't share your context
- Use the `Explore` agent for codebase research before making architectural decisions
- Use the `Plan` agent for designing implementation strategies on complex features
- If specialized agents aren't deployed yet, run `/project:setup-agents` to initialize them
- Match agent type to task: `backend` for Python/Rust/APIs, `frontend` for React/TS/UI, `tester` for tests, `reviewer` for code review

## DON'T
- Don't use subagents for simple single-file changes — do them directly
- Don't duplicate work between subagents and your own context
- Don't launch subagents that modify the same files in parallel — they'll conflict
- Don't forget to verify subagent output — they can make mistakes
- Don't pass partial context to subagents — include all relevant file paths and constraints
