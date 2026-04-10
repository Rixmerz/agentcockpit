---
paths: ["**/*.php"]
---

# PHP Code Rules

> Always apply these rules when writing or reviewing PHP code.

## DO

- Always use `declare(strict_types=1)` at the top of every PHP file
- Always use strict comparison (`===` / `!==`), never loose (`==` / `!=`)
- Use constructor promotion for DTOs and value objects
- Use readonly classes for immutable objects (PHP 8.2+)
- Use enums instead of class constants for finite sets (PHP 8.1+)
- Use `match()` instead of `switch` for value returns — match is strict and exhaustive
- Use named arguments for clarity when skipping optional parameters
- Use native attributes (`#[Route]`, `#[Assert\NotBlank]`) instead of docblock annotations
- Use prepared statements / parameter binding for ALL database queries — no exceptions
- Use `password_hash()` with `PASSWORD_ARGON2ID` for password storage
- Use null coalescing (`??`) for default values, nullsafe (`?->`) for method/property chaining
- Use PSR-4 autoloading via Composer
- Run PHPStan (level 8+) + PHP-CS-Fixer + tests in CI
- Escape all user output with `htmlspecialchars()` or template engine auto-escaping
- Use type declarations on all function parameters, return types, and class properties
- Use `readonly` properties for values that should not change after construction
- Prefer composition (interfaces + DI) over inheritance

## DON'T

- Don't use loose comparison (`==`) — type juggling causes subtle bugs (`0 == "foo"` is `true` in older PHP)
- Don't use `eval()` in production code — arbitrary code execution risk
- Don't use the `@` error suppression operator — it hides bugs and makes debugging impossible
- Don't use `mysql_*` functions — removed in PHP 7.0, use PDO or an ORM
- Don't store plaintext passwords — always hash with `password_hash()`
- Don't use `display_errors = On` in production — leaks internal paths and data
- Don't use string interpolation with complex expressions — extract to a variable first
- Don't use classic Singleton pattern (static `getInstance()`) — use DI container singleton binding
- Don't use docblock annotations (`@Route`, `@ORM\Entity`) when native PHP attributes are available
- Don't use `switch` when `match` works — match is strict, returns a value, and has no fallthrough bugs
- Don't echo unescaped user input — XSS vulnerability
- Don't use the backtick operator (`` ` ``) for shell commands — use `Process` component or `proc_open()`
- Don't use `extract()` — it creates variables from array keys, making code unpredictable
- Don't use `global` keyword — pass dependencies through constructor or function parameters
- Don't catch `Exception` and silently swallow it — always log or re-throw
