---
paths: ["**/*.lua"]
---

# Lua Code Rules

> Always apply these rules when writing or reviewing Lua code.

## DO

- Use `local` for ALL variables — no exceptions. Globals are a hash table lookup every time.
- Cache stdlib functions in locals at module top: `local insert = table.insert`, `local format = string.format`, etc.
- Return a table at the end of every module file (`local M = {} ... return M`).
- Use `table.concat` for string building in loops — `..` in loops is O(n^2).
- Use `ipairs` for sequences (integer-keyed arrays), `pairs` for dictionaries/mixed tables.
- Use `pcall` or `xpcall` for code that can fail at runtime.
- Return `nil, error_message` for expected/recoverable errors. Reserve `error()` for programmer mistakes.
- Define `__index` on the class table itself, not on each instance: `MyClass.__index = MyClass`.
- Use `:` syntax (colon) for methods that need `self`. Use `.` for static/utility functions.
- Use Luacheck + StyLua in CI for consistent linting and formatting.
- Use `coroutine.wrap` for simple generators and iterators.
- Use `table.pack` / `table.unpack` (Lua 5.2+) to handle varargs with possible nil values.
- Prefer LPeg over string patterns for complex parsing.
- Use `rawset`/`rawget` inside `__newindex`/`__index` metamethods to avoid infinite recursion.

## DON'T

- Don't create accidental globals — always use `local`. Enable the Luacheck "global" warning.
- Don't use `#` on tables with holes (nils in the sequence part) — the result is undefined behavior.
- Don't concatenate strings in loops with `..` — it creates a new string object every iteration, O(n^2) total.
- Don't modify a table while iterating it with `pairs` or `ipairs` — behavior is undefined. Collect keys/indices first, then modify.
- Don't use `tostring()` for type checking — use `type()` which returns a string like `"number"`, `"string"`, `"table"`.
- Don't assume `require` always succeeds — wrap with `pcall` for optional dependencies: `local ok, mod = pcall(require, "optional")`.
- Don't set metatables on hot paths without need — metatable lookups have overhead. Set once at construction time.
- Don't yield from inside `pcall` in Lua 5.1 or LuaJIT — it will error. This works in Lua 5.2+ only.
- Don't use `os.execute` or `io.popen` with user-supplied input — command injection risk. Sanitize or avoid.
- Don't use `loadstring`/`load` with untrusted input without sandboxing via a restricted `_ENV`.
- Don't rely on table iteration order with `pairs` — it is not guaranteed to be deterministic.
- Don't use `arg` table inside vararg functions in Lua 5.2+ — use `...` and `select`/`table.pack` instead.
- Don't forget that `false` and `nil` are both falsy — `x = x or default` will override `false` values. Use explicit `if x == nil then` for booleans.
