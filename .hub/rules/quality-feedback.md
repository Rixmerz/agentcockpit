# Quality Feedback — DCC & Experience Memory

> Always act on DCC and experience memory feedback — never ignore quality signals.

Rules for using DCC analysis, experience memory, and quality tools.

## DO
- After receiving DCC feedback via stderr (PostToolUse hook), prioritize fixing critical and high severity smells
- Use `graph_mid_phase_dcc(files=[...])` proactively when you've made significant changes and want quality feedback
- Check `experience_context` in `graph_traverse` responses — it contains relevant past issues for the files you're touching
- When `skill_recommendations` appear in traverse responses, read the suggested skill sections for guidance
- Use `graph_status` to check `dcc_status.last_analysis` for the most recent quality snapshot
- Trust DCC's tension gate — if it blocks a transition, there are real structural issues to resolve
- When DCC reports `god_file`, `circular_dependency`, or `hub_overload` smells, refactor before adding more code

## DON'T
- Don't ignore DCC delta feedback (the "DCC: +N new smells" messages in stderr)
- Don't acknowledge tensions just to bypass the gate — resolve them
- Don't skip the baseline DCC analysis on workflow activation — it gives you starting context
- Don't add code to files already flagged as `god_file` without splitting them first
- Don't treat DCC warnings as optional — they reflect real structural degradation
