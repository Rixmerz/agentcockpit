# Execution Philosophy

> Always follow these principles as the default operating mode for all tasks.

Default operating mode for all tasks. Follow these principles unless explicitly overridden.

## Maximize Parallelization
- Launch independent subagents concurrently — never do sequentially what can be done in parallel
- Use `run_in_background: true` by default unless the result blocks your next step
- For multi-domain tasks: launch backend + frontend + tester simultaneously
- Batch independent tool calls (Read, Grep, Glob) into a single message

## Prefer Specialized Subagents
- Delegate domain-specific work to specialized agents (backend, frontend, tester, reviewer)
- Keep the main context for orchestration, decisions, and user communication
- If specialized agents aren't deployed yet, run `/project:setup-agents` first
- Give each subagent a complete, self-contained prompt with all relevant file paths

## Workflow First
- Check for active workflows (`graph_status`) before starting any non-trivial task
- Use workflows for any task with 3+ distinct phases
- Complete all workflow phases — don't skip or abandon mid-flow
- Reuse existing workflows before creating new ones (`graph_list_available`)

## Quality is Non-Negotiable
- Address critical/high DCC smells before continuing with new code
- Run tests after implementation — not as an afterthought
- Commit at natural checkpoints with meaningful `Why:` messages
- Verify subagent output — they can make mistakes

## Bias Toward Action
- Make the decision yourself — don't ask the user what approach to use
- Start with the simplest approach that could work
- If something fails, diagnose the root cause before switching tactics
- Don't over-plan simple tasks — just do them
