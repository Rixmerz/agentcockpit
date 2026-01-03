# CFA v3.2 Setup Complete ✅

**Date**: 2026-01-02
**Project**: one-term
**Status**: Ready to use

---

## What Was Fixed

### Problem
- ❌ Hook configuration referenced hooks that didn't exist
- ❌ No `.claude/hooks/` directory in project
- ❌ Error: "can't open file '.claude/hooks/cfa_validator.py'"

### Solution Applied
1. ✅ Created `.claude/hooks/` directory
2. ✅ Copied `cfa_validator.py` (enforcement + metrics tracking)
3. ✅ Copied `cfa_smart_suggestions.py` (intelligent suggestions)
4. ✅ Created `settings.json` with hook configuration

---

## Project Structure

```
one-term/
├── .claude/
│   ├── settings.json          (Hook configuration)
│   ├── settings.local.json    (Permission whitelist)
│   ├── knowledge_graph.db     (Code context index)
│   ├── memory.db              (Learnings store)
│   ├── map.md                 (Project navigation)
│   └── hooks/
│       ├── cfa_validator.py        (Enforcement hooks)
│       └── cfa_smart_suggestions.py (Intelligent hooks)
└── [source code]
```

---

## CFA Protocol

When starting work on this project, follow this sequence:

### 1. Session Start
```
workflow.onboard(project_path=".", show_instructions=true)
```
This loads the project context and protocol.

### 2. Before Editing
```
kg.retrieve(task="what you're about to do")
```
This loads relevant code context. **REQUIRED before editing** (enforced by PreToolUse hook).

### 3. During Development

**After function changes**, run:
```
contract.check_breaking(project_path=".", symbol="function_name")
```

**After multiple edits** (3+), the system will suggest:
```
kg.build(project_path=".", incremental=true)
```

### 4. Session End

Before committing, run:
```
memory.set(
    project_path=".",
    key="what-you-learned",
    value="Key insights or patterns discovered",
    tags=["pattern", "gotcha", "architecture"]
)
```

---

## Hook System Active

### Enforcement Level: STRICT

| Event | What Happens | Action |
|-------|--------------|--------|
| **SessionStart** | Project context loaded | ℹ️ Shows protocol |
| **PreToolUse (Edit)** | Blocks edit without kg.retrieve | ⛔ BLOCKS until context loaded |
| **PreToolUse (kg.retrieve/kg.build)** | Tracks when called | 📊 Updates session state |
| **PostToolUse (Edit)** | Detects function changes | 🔍 Flags for validation |
| **PostToolUse (Edit)** | Analyzes edit patterns | 💡 Smart suggestions |

### Smart Suggestions

After edits, the system automatically detects and suggests:

- **After 3+ edits**: "Consider running kg.build"
- **After function changes**: "Run contract.check_breaking"
- **After 5+ edits**: "Store learnings with memory.set"
- **After 10+ edits**: "Create checkpoint with safe_point.create"

---

## Files Modified

**In one-term project**:
- ✅ Created: `.claude/hooks/cfa_validator.py`
- ✅ Created: `.claude/hooks/cfa_smart_suggestions.py`
- ✅ Created: `.claude/settings.json`
- ✅ Kept: `.claude/settings.local.json` (permissions)

---

## Quick Test

To verify hooks are working:

```bash
# Test validator hook
python3 .claude/hooks/cfa_validator.py <<< '{"hook_event_name":"SessionStart","cwd":"."}'

# Expected output: JSON with "decision": "approve"
```

---

## Next Steps

1. **Start session**: `workflow.onboard(project_path=".", show_instructions=true)`
2. **Load context**: `kg.retrieve(task="<describe your task>")`
3. **Edit code**: Make your changes
4. **Validate**: Run suggested tools as they appear
5. **Commit**: Add learnings with `memory.set` before git commit

---

## Troubleshooting

### Issue: "can't open file '.claude/hooks/cfa_validator.py'"
**Solution**: You're already here! The hooks are now installed.

### Issue: Hook still not executing
**Solution**: Verify Python is accessible:
```bash
python3 --version  # Should show 3.13+
```

### Issue: Want to disable hooks temporarily
**Solution**: Rename `settings.json` to `settings.json.bak`
```bash
mv .claude/settings.json .claude/settings.json.bak
```

---

## System Information

- **CFA Version**: 3.2
- **Python**: 3.13.7
- **Hooks**: cfa_validator.py + cfa_smart_suggestions.py
- **Project Context**: Knowledge Graph (18MB)
- **Memory Store**: SQLite (learnings database)

---

**Setup completed successfully. You're ready to use CFA!**
