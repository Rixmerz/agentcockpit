# Serena MCP — Semantic Code Navigation

> Always use Serena MCP tools as the primary method for code navigation and editing — for every task, in every language.

Use Serena MCP tools as the primary method for code navigation and editing during development.

## DO
- Use `find_symbol` to locate functions, classes, and methods before reading files
- Use `get_symbols_overview` to understand a file's structure before diving in
- Use `replace_symbol_body` to edit specific symbols instead of rewriting entire files
- Use `find_referencing_symbols` to understand impact before modifying a symbol
- Use `insert_after_symbol` / `insert_before_symbol` to add code at precise locations
- Use `search_for_pattern` when you're unsure of a symbol's exact name or location
- Use `safe_delete_symbol` to remove symbols — it verifies no references remain
- Use `rename_symbol` for refactors — it updates all references automatically

## DON'T
- Don't read entire files with Read when you only need a specific symbol — use `find_symbol` with `include_body: true`
- Don't use Edit/Write for symbol-level changes when `replace_symbol_body` is more precise
- Don't grep for a symbol name and then read the whole file — use `find_symbol` directly
- Don't manually track references when refactoring — use `find_referencing_symbols` first

## Why
Serena operates at the AST/symbol level, not the text level. This means edits are more precise, refactors are safer, and navigation is faster — especially in large files. It reduces the risk of accidentally breaking surrounding code when modifying a single function or class.
