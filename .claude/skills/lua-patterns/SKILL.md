---
name: lua-patterns
description: Lua architecture reference - frameworks, metatables, coroutines, game dev, embedded scripting, and production best practices for 2024-2025. Use when making architectural decisions, reviewing Lua code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# Lua Architecture Patterns

## Quick Navigation

- [Frameworks & Libraries](frameworks.md) - Game dev, web, embedded, tooling
- [Design Patterns](design-patterns.md) - OOP, factory, observer, state machines
- [Architecture](architecture.md) - ECS, plugins, MVC, project structures
- [Best Practices](best-practices.md) - Performance, error handling, modules
- [Language Features](language-features.md) - Metatables, coroutines, FFI, sandboxing

## Decision Framework

| Domain | Stack | Why |
|--------|-------|-----|
| Game dev (2D) | Love2D + bump + hump | Mature ecosystem, fast iteration, LuaJIT performance |
| Game dev (3D/mobile) | Defold | Built-in editor, cross-platform, free |
| Game dev (platform) | Roblox/Luau | Massive audience, type-safe Lua dialect |
| Web/Backend | OpenResty + Lapis | Nginx-level perf, non-blocking I/O, cosocket API |
| API Gateway | Kong | Plugin architecture, declarative config, enterprise support |
| Embedded/IoT | NodeMCU (ESP8266/32) | Tiny footprint, event-driven, WiFi/MQTT built in |
| Editor scripting | Neovim Lua API | First-class Lua, async, treesitter integration |
| Config/scripting host | Embed Lua 5.4 C API | 300KB footprint, sandboxable, battle-tested |

## Recommended Stack 2025

- **Language server:** lua-language-server (sumneko)
- **Linter:** Luacheck
- **Formatter:** StyLua
- **Package manager:** LuaRocks
- **Type annotations:** LuaCATS (lua-language-server) or Teal
- **Testing:** Busted + luacov
- **CI:** Luacheck + StyLua --check + Busted

## Lua Versions

| Version | Status | Key Features |
|---------|--------|--------------|
| Lua 5.4 | Current stable (Dec 2023) | Integers, to-be-closed vars, generational GC |
| Lua 5.5 | In development | Under-construction, not for production |
| LuaJIT 2.1 | Stable (rolling) | Trace JIT, FFI, bitop, ~5-50x faster than PUC Lua |
| Luau | Active (Roblox) | Type annotations, type inference, no JIT but fast VM |

## Production Users

| User | Scale | Use Case |
|------|-------|----------|
| Roblox | 70M+ DAU | Game scripting (Luau) |
| Kong | Billions req/day | API gateway plugins |
| Neovim | Millions of users | Editor config and plugins |
| World of Warcraft | Millions of players | Addon system |
| Cloudflare | Millions of sites | WAF rules, Workers (historical) |
| Warframe | 70M+ registered | Game scripting |
| Redis | Ubiquitous | EVAL scripting |
| NGINX/OpenResty | Millions of servers | Request handling, routing |
| Adobe Lightroom | Millions of users | Plugin system |
| VLC | Millions of users | Extension scripting |

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
