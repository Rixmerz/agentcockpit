# Lua Frameworks & Libraries

## Game Development

| Framework | Type | Platform | Language | Notes |
|-----------|------|----------|----------|-------|
| Love2D | 2D engine | Desktop, mobile (via ports) | LuaJIT | Most popular Lua game framework, excellent community |
| Defold | 2D/3D engine | All platforms | Lua 5.1 | Free, built-in editor, HTML5 export |
| Roblox/Luau | Platform | All platforms | Luau | Type-safe Lua dialect, 70M+ DAU |
| Solar2D | 2D engine | Mobile, desktop | Lua 5.1 | Formerly Corona SDK, open source |
| PICO-8 | Fantasy console | Desktop, web | Lua subset | 128x128 screen, 32KB cart, great for jams |
| TIC-80 | Fantasy console | Desktop, web, mobile | Lua (+ others) | Open source PICO-8 alternative |

## Love2D Essential Libraries

| Library | Purpose | Usage |
|---------|---------|-------|
| bump.lua | AABB collision detection | `local bump = require "bump"; world = bump.newWorld(64)` |
| anim8 | Sprite animation | Grids and animations from spritesheets |
| hump | Helper utilities | Camera, gamestate, timer, vector, class |
| STI (Simple Tiled) | Tiled map loader | Load .tmx maps from Tiled editor |
| flux | Tweening | `flux.to(obj, 1, {x = 100}):ease("quadout")` |
| lume | Utility functions | map, filter, merge, hotswap, serialize |
| lurker | Hot-reloading | Auto-reload changed files during dev |
| SUIT | Immediate-mode GUI | `suit.Label("Hello", {align="center"}, x, y, w, h)` |

## Web & Backend

| Framework | Type | Notes |
|-----------|------|-------|
| OpenResty | Web platform | NGINX + LuaJIT, cosocket non-blocking I/O, production-grade |
| Lapis | Web framework | Runs on OpenResty, MVC, ORM, migrations, routing |
| Sailor | MVC framework | Compatible with multiple servers (OpenResty, Apache, Nginx) |
| Pegasus | HTTP server | Pure Lua, lightweight, good for embedded |
| Redbean | Single-binary server | Cosmopolitan libc, embeds Lua, zips into one executable |

## Database Drivers

| Library | Database | Context |
|---------|----------|---------|
| lua-resty-mysql | MySQL/MariaDB | OpenResty non-blocking |
| lua-resty-postgres | PostgreSQL | OpenResty non-blocking |
| lua-resty-redis | Redis | OpenResty non-blocking, connection pooling |
| LuaSQL | Multiple (MySQL, PostgreSQL, SQLite, ODBC) | Standard blocking driver |
| LSQLITE3 | SQLite3 | Direct binding, good for embedded |

## Embedded / IoT (NodeMCU)

| Module | Purpose |
|--------|---------|
| wifi | Station/AP mode, scan, connect |
| mqtt | MQTT client, publish/subscribe |
| gpio | Digital I/O, pin modes, interrupts |
| i2c | I2C bus communication |
| tmr | Timers, delays, alarms |
| sjson | Fast JSON encode/decode |
| http | HTTP client requests |
| net | TCP/UDP sockets |
| file | SPIFFS filesystem access |
| adc | Analog-to-digital conversion |

## Scripting Host Ecosystems

### Neovim

| Plugin/Tool | Purpose |
|-------------|---------|
| lazy.nvim | Plugin manager (lazy-loading, lockfile) |
| telescope.nvim | Fuzzy finder (files, grep, buffers, anything) |
| nvim-cmp | Autocompletion engine |
| nvim-treesitter | Syntax highlighting, text objects |
| nvim-lspconfig | LSP client configuration |
| mini.nvim | Collection of minimal modules |

### Redis

```lua
-- EVAL scripting: atomic operations
redis.call("SET", KEYS[1], ARGV[1])
redis.call("EXPIRE", KEYS[1], ARGV[2])
return redis.call("GET", KEYS[1])
```

### Kong Plugins

```
kong/plugins/my-plugin/
  handler.lua    -- Plugin logic (access, header_filter, body_filter, log phases)
  schema.lua     -- Configuration schema
```

### WoW Addons

```
MyAddon/
  MyAddon.toc       -- Table of contents (metadata, file list)
  MyAddon.lua        -- Main code
  MyAddon.xml        -- UI frames (optional)
  Libs/              -- Embedded libraries (Ace3, LibStub)
```

## General-Purpose Libraries

| Library | Purpose | Notes |
|---------|---------|-------|
| Penlight | Stdlib extension | Paths, strings, tables, classes, comprehensions |
| moses | Functional programming | map, reduce, filter, zip, chain |
| lua-cjson | JSON (C binding) | Fast, OpenResty default |
| dkjson | JSON (pure Lua) | No C dependency, good compatibility |
| serpent | Serialization | Human-readable Lua table serializer |
| LuaSocket | TCP/UDP/HTTP | Standard networking library |
| LuaSec | TLS/SSL | OpenSSL binding, works with LuaSocket |
| copas | Coroutine scheduler | Async I/O on top of LuaSocket |
| LPeg | Parsing (PEG) | Powerful pattern matching beyond string.find |
| lfs (LuaFileSystem) | Filesystem | Directory iteration, attributes, mkdir |
| lanes | Multithreading | True OS threads with message passing |

## Testing & Quality

| Tool | Purpose | Notes |
|------|---------|-------|
| Busted | Test framework | BDD style, async support, mocks, spies |
| LuaUnit | Test framework | xUnit style, simpler than Busted |
| luacov | Code coverage | Line coverage, works with Busted |

## Tooling

| Tool | Purpose | Notes |
|------|---------|-------|
| LuaRocks | Package manager | Standard Lua package manager, 3000+ packages |
| Luacheck | Linter | Unused vars, globals, style, highly configurable |
| StyLua | Formatter | Opinionated, inspired by Prettier, fast (Rust) |
| lua-language-server | LSP | Sumneko, LuaCATS annotations, type checking |
| Teal | Typed Lua | Compiles to Lua, gradual typing |
| Fennel | Lisp on Lua | Lisp syntax compiling to Lua, macros |
