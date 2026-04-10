# Lua Language Features

## Metatables and Metamethods

Metatables control the behavior of tables via special keys (metamethods).

```lua
local mt = {}

-- __index: called when key is not found in table
-- Can be a table (prototype chain) or a function (computed access)
mt.__index = function(self, key)
    return "default_" .. key
end

-- __newindex: called when assigning to a key that doesn't exist
mt.__newindex = function(self, key, value)
    rawset(self, key, value)  -- use rawset to avoid recursion
    print("Set " .. key .. " = " .. tostring(value))
end

-- __call: makes table callable like a function
mt.__call = function(self, ...)
    return "called with " .. select("#", ...) .. " args"
end

-- __tostring: custom string representation
mt.__tostring = function(self)
    return "MyObject(" .. (self.name or "?") .. ")"
end

-- __len: custom # operator
mt.__len = function(self)
    return self._size or 0
end

-- Arithmetic metamethods
mt.__add = function(a, b) end      -- a + b
mt.__sub = function(a, b) end      -- a - b
mt.__mul = function(a, b) end      -- a * b
mt.__div = function(a, b) end      -- a / b
mt.__mod = function(a, b) end      -- a % b
mt.__pow = function(a, b) end      -- a ^ b
mt.__unm = function(a) end         -- -a
mt.__idiv = function(a, b) end     -- a // b (Lua 5.3+)
mt.__band = function(a, b) end     -- a & b  (Lua 5.3+)
mt.__bor = function(a, b) end      -- a | b  (Lua 5.3+)
mt.__bxor = function(a, b) end     -- a ~ b  (Lua 5.3+)
mt.__bnot = function(a) end        -- ~a      (Lua 5.3+)
mt.__shl = function(a, b) end      -- a << b  (Lua 5.3+)
mt.__shr = function(a, b) end      -- a >> b  (Lua 5.3+)

-- Comparison metamethods
mt.__eq = function(a, b) end       -- a == b
mt.__lt = function(a, b) end       -- a < b
mt.__le = function(a, b) end       -- a <= b

-- __concat: a .. b
mt.__concat = function(a, b) end

-- __gc: finalizer (Lua 5.2+, tables; Lua 5.1 only userdata)
mt.__gc = function(self)
    -- cleanup resources
end

-- __close: to-be-closed variable finalizer (Lua 5.4)
mt.__close = function(self, err)
    -- called when variable goes out of scope
end

local obj = setmetatable({}, mt)
```

### Practical Example: Read-Only Table

```lua
local function readOnly(t)
    return setmetatable({}, {
        __index = t,
        __newindex = function()
            error("attempt to modify read-only table", 2)
        end,
        __len = function() return #t end,
    })
end

local constants = readOnly({ PI = 3.14159, E = 2.71828 })
print(constants.PI)     -- 3.14159
constants.PI = 3        -- ERROR: attempt to modify read-only table
```

## Coroutines

Coroutines are cooperative (not preemptive) threads within a single OS thread.

```lua
-- States: suspended, running, normal, dead

-- coroutine.create: returns a coroutine object
local co = coroutine.create(function(a, b)
    print("first resume:", a, b)     -- 1, 2
    local c = coroutine.yield(a + b) -- yields 3, receives 10
    print("second resume:", c)       -- 10
    return "done"
end)

print(coroutine.status(co))             -- "suspended"
local ok, val = coroutine.resume(co, 1, 2)  -- ok=true, val=3
print(coroutine.status(co))             -- "suspended"
local ok, val = coroutine.resume(co, 10)     -- ok=true, val="done"
print(coroutine.status(co))             -- "dead"

-- coroutine.wrap: returns a function (simpler API, no ok/err)
local gen = coroutine.wrap(function()
    for i = 1, 5 do
        coroutine.yield(i)
    end
end)

print(gen())  -- 1
print(gen())  -- 2
-- ...
```

### Pipeline with Coroutines

```lua
local function filter(input, predicate)
    return coroutine.wrap(function()
        for item in input do
            if predicate(item) then
                coroutine.yield(item)
            end
        end
    end)
end

local function map(input, transform)
    return coroutine.wrap(function()
        for item in input do
            coroutine.yield(transform(item))
        end
    end)
end

local function fromArray(arr)
    return coroutine.wrap(function()
        for _, v in ipairs(arr) do
            coroutine.yield(v)
        end
    end)
end

-- Compose: array -> filter evens -> double
local data = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }
local pipeline = map(
    filter(fromArray(data), function(x) return x % 2 == 0 end),
    function(x) return x * 2 end
)

for value in pipeline do
    print(value)  -- 4, 8, 12, 16, 20
end
```

## Multiple Return Values

```lua
local function divmod(a, b)
    return math.floor(a / b), a % b
end

local quot, rem = divmod(17, 5)  -- 3, 2

-- Only the last call in an expression list expands
local function multi() return 1, 2, 3 end
local t = { multi() }       -- { 1, 2, 3 }
local t = { multi(), "x" }  -- { 1, "x" }  (multi truncated to 1)

-- select: access specific return value
local function many() return "a", "b", "c", "d" end
print(select(3, many()))    -- "c", "d" (from 3rd onward)
print(select("#", many()))  -- 4 (count)
```

## String Patterns (NOT Regex)

Lua string patterns are simpler than regex. No alternation `|`, no grouping quantifiers.

```lua
-- Character classes
-- %a  letters              %A  non-letters
-- %d  digits               %D  non-digits
-- %l  lowercase            %L  non-lowercase
-- %u  uppercase            %U  non-uppercase
-- %w  alphanumeric         %W  non-alphanumeric
-- %s  whitespace           %S  non-whitespace
-- %p  punctuation          %P  non-punctuation
-- %c  control chars        %C  non-control
-- .   any character

-- Quantifiers
-- *   0 or more (greedy)
-- +   1 or more (greedy)
-- -   0 or more (lazy)
-- ?   0 or 1

-- Anchors
-- ^   start of string
-- $   end of string

-- Examples
local s = "Hello World 123"
print(s:match("(%a+)"))          -- "Hello" (first word)
print(s:match("(%d+)"))          -- "123"

-- gmatch: iterate over all matches
for word in s:gmatch("%a+") do
    print(word)  -- Hello, World
end

-- gsub: replace
print(s:gsub("%d+", "###"))      -- "Hello World ###"
print(("  spaces  "):match("^%s*(.-)%s*$"))  -- "spaces" (trim)

-- Captures
local date = "2025-03-07"
local y, m, d = date:match("(%d+)-(%d+)-(%d+)")
-- y="2025", m="03", d="07"

-- For complex parsing, use LPeg instead
```

## Environment System (_ENV, Sandboxing)

```lua
-- Lua 5.2+: _ENV replaces setfenv/getfenv
-- Every free name x is translated to _ENV.x

-- Sandboxing: run untrusted code with limited globals
local function sandbox(code, allowed_globals)
    local env = {}
    for k, v in pairs(allowed_globals) do
        env[k] = v
    end
    env._G = env

    local fn, err = load(code, "sandbox", "t", env)
    if not fn then
        return nil, err
    end
    return pcall(fn)
end

local ok, result = sandbox([[
    return math.sqrt(16) + #("hello")
]], {
    math = { sqrt = math.sqrt },
    tostring = tostring,
    type = type,
})
-- ok=true, result=9.0

-- os, io, debug, loadfile are NOT in the sandbox
```

## To-Be-Closed Variables (Lua 5.4)

```lua
-- <close> attribute: __close metamethod called when var goes out of scope
-- Similar to RAII in C++ or defer in Go

local function openFile(path)
    local f = io.open(path, "r")
    if not f then return nil, "cannot open" end
    -- Set __close metamethod
    return setmetatable({ file = f }, {
        __close = function(self, err)
            if self.file then
                self.file:close()
                self.file = nil
            end
        end,
        __index = {
            read = function(self, ...) return self.file:read(...) end,
        },
    })
end

do
    local f <close> = openFile("data.txt")
    if f then
        local content = f:read("*a")
        -- f is automatically closed when this block exits
        -- even if an error occurs
    end
end
-- f.__close has been called here
```

## Varargs and table.pack / table.unpack

```lua
-- ... captures variable arguments
local function sum(...)
    local total = 0
    -- Lua 5.2+: table.pack preserves nils and count
    local args = table.pack(...)
    for i = 1, args.n do
        total = total + (args[i] or 0)
    end
    return total
end

-- table.unpack (Lua 5.2+) or unpack (Lua 5.1)
local t = { 10, 20, 30 }
print(table.unpack(t))       -- 10, 20, 30
print(table.unpack(t, 2, 3)) -- 20, 30

-- select for varargs without packing
local function first3(...)
    return select(1, ...), select(2, ...), select(3, ...)
    -- Actually wrong: select returns from nth onward
    -- Correct approach:
end

local function countArgs(...)
    return select("#", ...)
end
```

## Goto (Continue Simulation, Nested Loop Break)

```lua
-- Lua 5.2+ has goto (no continue keyword)

-- Simulate continue
for i = 1, 10 do
    if i % 3 == 0 then
        goto continue
    end
    print(i)  -- prints 1, 2, 4, 5, 7, 8, 10
    ::continue::
end

-- Break out of nested loops
for i = 1, 10 do
    for j = 1, 10 do
        if i * j > 50 then
            goto done
        end
        print(i, j)
    end
end
::done::
print("exited nested loops")

-- Labels are local to the block they're in
-- Cannot jump into a block, only out of one
```

## LuaJIT FFI (Zero-Overhead C Interop)

```lua
local ffi = require("ffi")

-- Declare C types and functions
ffi.cdef[[
    typedef struct { double x, y; } Point;

    // System calls
    int printf(const char *fmt, ...);
    void *malloc(size_t size);
    void free(void *ptr);

    // POSIX
    unsigned int sleep(unsigned int seconds);
    int usleep(unsigned int usec);
]]

-- Use C structs directly (no Lua table overhead)
local p = ffi.new("Point", 1.5, 2.5)
print(p.x, p.y)  -- 1.5, 2.5

-- Arrays
local arr = ffi.new("int[?]", 100)  -- 100 ints, zero-initialized
for i = 0, 99 do
    arr[i] = i * 2
end

-- Call C functions directly
ffi.C.printf("Hello from C! %d\n", 42)

-- Load shared libraries
local ssl = ffi.load("ssl")
ffi.cdef[[
    int RAND_bytes(unsigned char *buf, int num);
]]
local buf = ffi.new("unsigned char[16]")
ssl.RAND_bytes(buf, 16)

-- C strings
local cstr = ffi.new("char[?]", 256)
ffi.copy(cstr, "Hello FFI")
print(ffi.string(cstr))  -- "Hello FFI"

-- Metatype: attach methods to C types
ffi.cdef[[ typedef struct { float x, y; } Vec2; ]]

local Vec2
Vec2 = ffi.metatype("Vec2", {
    __add = function(a, b)
        return Vec2(a.x + b.x, a.y + b.y)
    end,
    __tostring = function(v)
        return string.format("Vec2(%g, %g)", v.x, v.y)
    end,
    __index = {
        length = function(self)
            return math.sqrt(self.x^2 + self.y^2)
        end,
    },
})

local v = Vec2(3, 4)
print(v:length())      -- 5
print(v + Vec2(1, 1))  -- Vec2(4, 5)
```
