# Lua Best Practices

## Performance: Always Use `local`

```lua
-- BAD: global access is a hash table lookup every time
for i = 1, 1000000 do
    x = math.sin(i)  -- 2 global lookups: math, then sin
end

-- GOOD: cache stdlib functions in locals at module top
local sin = math.sin
local floor = math.floor
local format = string.format
local insert = table.insert
local concat = table.concat
local pairs = pairs
local ipairs = ipairs
local type = type

for i = 1, 1000000 do
    x = sin(i)  -- direct local access, ~30% faster
end
```

## Error Handling

### pcall / xpcall for Protected Calls

```lua
-- pcall: catch errors without crashing
local ok, result = pcall(function()
    return riskyOperation()
end)

if not ok then
    print("Error: " .. tostring(result))
end

-- xpcall: pcall with a custom error handler (gets stack trace)
local ok, result = xpcall(
    function()
        return riskyOperation()
    end,
    function(err)
        return debug.traceback(err, 2)
    end
)

if not ok then
    log.error(result)  -- includes full stack trace
end
```

### nil + message Convention for Expected Errors

```lua
-- Return nil, error_message for expected failures
-- Reserve error() for programmer mistakes

local function readConfig(path)
    local file, err = io.open(path, "r")
    if not file then
        return nil, "cannot open config: " .. err
    end

    local content = file:read("*a")
    file:close()

    local ok, data = pcall(json.decode, content)
    if not ok then
        return nil, "invalid JSON in config: " .. data
    end

    return data
end

-- Caller
local config, err = readConfig("settings.json")
if not config then
    print("Warning: " .. err .. ", using defaults")
    config = defaults
end
```

### Optional Dependencies with pcall

```lua
local has_cjson, cjson = pcall(require, "cjson")
local has_dkjson, dkjson = pcall(require, "dkjson")

local json
if has_cjson then
    json = cjson
elseif has_dkjson then
    json = dkjson
else
    error("no JSON library found: install cjson or dkjson")
end
```

## Tables

### String Concatenation: table.concat vs ..

```lua
-- BAD: O(n^2) - each .. creates a new string
local result = ""
for i = 1, 10000 do
    result = result .. "line " .. i .. "\n"
end

-- GOOD: O(n) - collect in table, join once
local parts = {}
for i = 1, 10000 do
    parts[#parts + 1] = "line " .. i
end
local result = table.concat(parts, "\n")
```

### Preallocate Tables When Size Is Known

```lua
-- LuaJIT: table.new(narr, nrec)
local ffi = require("ffi")
local new_tab = require("table.new")

local t = new_tab(1000, 0)  -- preallocate 1000 array slots
for i = 1, 1000 do
    t[i] = i * 2
end

-- PUC Lua 5.4: no table.new, but you can use {nil, nil, ...}
-- or just accept the resizing cost
```

### Length Operator: Only for Sequences

```lua
-- # is ONLY defined for sequences (no holes)
local seq = { 10, 20, 30, 40 }
print(#seq)  -- 4 (correct, it's a sequence)

-- BAD: undefined behavior with holes
local holed = { 1, nil, 3, nil, 5 }
print(#holed)  -- could be 1, 3, or 5 (implementation-defined)

-- For dicts, count manually
local function tableSize(t)
    local count = 0
    for _ in pairs(t) do
        count = count + 1
    end
    return count
end
```

## Modules and require

```lua
-- require caches by module name in package.loaded
-- First require("mymod") runs the file and caches the return value
-- Subsequent require("mymod") returns the cached value

-- Circular dependency resolution
-- a.lua
local M = {}
package.loaded["a"] = M  -- register early before requiring b
local b = require("b")   -- b can now require("a") and get M
function M.hello() return "hello from a" end
return M
```

## Weak Tables for Cache Without Leaks

```lua
-- Weak values: entries are collected when no other references exist
local cache = setmetatable({}, { __mode = "v" })

local function getTexture(path)
    local tex = cache[path]
    if tex then
        return tex
    end
    tex = loadTexture(path)  -- expensive
    cache[path] = tex
    return tex
end

-- When nothing else references the texture, GC collects it
-- and cache[path] becomes nil automatically

-- __mode = "k" : weak keys
-- __mode = "v" : weak values
-- __mode = "kv": both weak
```

## Coroutines for Cooperative Concurrency

```lua
-- Producer-consumer with coroutines
local function producer(items)
    return coroutine.create(function()
        for _, item in ipairs(items) do
            -- simulate async fetch
            local processed = item:upper()
            coroutine.yield(processed)
        end
    end)
end

local function consumer(prod)
    while true do
        local ok, value = coroutine.resume(prod)
        if not ok or coroutine.status(prod) == "dead" then
            break
        end
        print("Consumed: " .. value)
    end
end

consumer(producer({"apple", "banana", "cherry"}))
```

### Async Tasks with Coroutines

```lua
local tasks = {}

local function async(fn)
    local co = coroutine.create(fn)
    tasks[#tasks + 1] = co
end

local function await(seconds)
    local resume_at = os.clock() + seconds
    coroutine.yield(resume_at)
end

local function runLoop()
    while #tasks > 0 do
        local now = os.clock()
        for i = #tasks, 1, -1 do
            local co = tasks[i]
            if coroutine.status(co) == "dead" then
                table.remove(tasks, i)
            else
                local ok, resume_at = coroutine.resume(co)
                if not ok then
                    print("Task error: " .. tostring(resume_at))
                    table.remove(tasks, i)
                elseif coroutine.status(co) == "dead" then
                    table.remove(tasks, i)
                end
            end
        end
    end
end
```

## Tooling in CI

### .luacheckrc

```lua
-- .luacheckrc
std = "lua51+luajit"  -- or "lua54"
globals = { "love" }  -- Love2D global
max_line_length = 120

ignore = {
    "212",  -- unused argument (common with callbacks)
}

files["spec/**/*.lua"] = {
    std = "+busted",
}
```

### stylua.toml

```toml
column_width = 120
line_endings = "Unix"
indent_type = "Spaces"
indent_width = 4
quote_style = "AutoPreferDouble"
call_parentheses = "Always"
```

### CI Pipeline

```yaml
# .github/workflows/lua.yml
steps:
  - name: Lint
    run: luacheck src/ --no-color

  - name: Format check
    run: stylua --check src/

  - name: Test
    run: busted --verbose --coverage

  - name: Coverage
    run: luacov && cat luacov.report.out
```

## Idioms

### Default Values

```lua
-- Lua idiom: or for defaults
local function greet(name)
    name = name or "World"
    return "Hello, " .. name
end

-- CAUTION: fails for boolean false
local function setFlag(value)
    -- BAD: if value is false, this becomes true
    value = value or true

    -- GOOD: explicit nil check
    if value == nil then
        value = true
    end
end
```

### Ternary Expression

```lua
-- Lua has no ternary operator, use and/or
local status = (hp > 0) and "alive" or "dead"

-- CAUTION: fails if the "true" branch is false or nil
-- (hp > 0) and false or "dead" --> always "dead"
-- Use if/else for those cases
```

### Method Chaining

```lua
local Builder = {}
Builder.__index = Builder

function Builder.new()
    return setmetatable({ parts = {} }, Builder)
end

function Builder:add(part)
    self.parts[#self.parts + 1] = part
    return self  -- return self for chaining
end

function Builder:build()
    return table.concat(self.parts, " ")
end

local result = Builder.new():add("Hello"):add("World"):build()
-- "Hello World"
```
