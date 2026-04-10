# Workflow Discipline

> Always respect workflow phase discipline when a workflow is active.

Rules for respecting the workflow system during active pipelines.

## DO
- Check `graph_status` at the start of any task to know your current phase
- Respect `tools_blocked` — if a tool is blocked in your current node, advance the workflow first
- Use `graph_mid_phase_dcc` after significant edits (5+ files or major refactors) to get quality feedback without advancing
- Read the `prompt_injection` from the current node — it contains phase-specific instructions
- When DCC reports new smells via stderr (PostToolUse hook), address critical/high severity ones before continuing
- Complete the current workflow phase before moving to the next — don't skip steps
- Use `graph_acknowledge_tensions` only when tensions are intentional, not to bypass quality gates

## DON'T
- Don't ignore DCC feedback — smells and tensions reported between phases indicate real issues
- Don't advance the workflow if the tension gate blocks you — resolve the tensions first
- Don't disable the enforcer to bypass blocked tools — advance the phase properly
- Don't start a new workflow without checking if one is already active (`graph_status`)
- Don't modify workflow graph definitions during an active traversal
