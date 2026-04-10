# Lua Design Patterns

## OOP with Metatables (Prototype-Based)

```lua
local Animal = {}
Animal.__index = Animal

function Animal.new(name, sound)
    local self = setmetatable({}, Animal)
    self.name = name
    self.sound = sound
    return self
end

function Animal:speak()
    return self.name .. " says " .. self.sound
end

-- Inheritance via __index chain
local Dog = setmetatable({}, { __index = Animal })
Dog.__index = Dog

function Dog.new(name)
    local self = Animal.new(name, "Woof")
    return setmetatable(self, Dog)
end

function Dog:fetch(item)
    return self.name .. " fetches " .. item
end

local rex = Dog.new("Rex")
print(rex:speak())       -- "Rex says Woof" (inherited)
print(rex:fetch("ball")) -- "Rex fetches ball"
```

## OOP with Closures (Real Encapsulation)

```lua
local function createCounter(initial)
    local count = initial or 0  -- truly private

    local self = {}

    function self.increment()
        count = count + 1
    end

    function self.decrement()
        count = count - 1
    end

    function self.getCount()
        return count
    end

    return self
end

local c = createCounter(10)
c.increment()
print(c.getCount())  -- 11
-- c.count is nil: no way to access it directly
```

## Factory Pattern

```lua
local shapes = {}

shapes.circle = function(radius)
    return {
        type = "circle",
        radius = radius,
        area = function(self) return math.pi * self.radius ^ 2 end,
    }
end

shapes.rect = function(w, h)
    return {
        type = "rect",
        w = w, h = h,
        area = function(self) return self.w * self.h end,
    }
end

local function createShape(kind, ...)
    local factory = shapes[kind]
    if not factory then
        return nil, "unknown shape: " .. tostring(kind)
    end
    return factory(...)
end

local c = createShape("circle", 5)
print(c:area())  -- 78.54
```

## Singleton via Module

```lua
-- config.lua
-- require() caches the return value, so this runs once
local M = {}

M.debug = false
M.log_level = "info"
M.max_connections = 100

function M.load(path)
    -- load from file...
    M.debug = true
end

return M

-- Any file that does require("config") gets the SAME table
```

## Decorator with Metatables

```lua
local function withLogging(obj, name)
    local proxy = {}
    setmetatable(proxy, {
        __index = function(_, key)
            local value = obj[key]
            if type(value) == "function" then
                return function(self, ...)
                    print(("[%s] calling %s"):format(name, key))
                    return value(obj, ...)
                end
            end
            return value
        end,
    })
    return proxy
end

local db = { query = function(self, sql) return "results" end }
local logged_db = withLogging(db, "DB")
logged_db:query("SELECT 1")  -- prints "[DB] calling query"
```

## Module Pattern

```lua
-- mymodule.lua
local M = {}

-- Private
local cache = {}

local function validate(input)
    return type(input) == "string" and #input > 0
end

-- Public
function M.process(input)
    if not validate(input) then
        return nil, "invalid input"
    end
    if cache[input] then
        return cache[input]
    end
    local result = input:upper()
    cache[input] = result
    return result
end

function M.clearCache()
    cache = {}
end

return M
```

## Mixin Composition

```lua
local Serializable = {}
function Serializable:serialize()
    local parts = {}
    for k, v in pairs(self) do
        if type(v) ~= "function" then
            parts[#parts + 1] = k .. "=" .. tostring(v)
        end
    end
    return "{" .. table.concat(parts, ", ") .. "}"
end

local Printable = {}
function Printable:dump()
    print(tostring(self))
end

local function mixin(target, ...)
    for _, source in ipairs({...}) do
        for k, v in pairs(source) do
            if target[k] == nil then
                target[k] = v
            end
        end
    end
    return target
end

local Player = {}
Player.__index = Player
mixin(Player, Serializable, Printable)

function Player.new(name, hp)
    return setmetatable({ name = name, hp = hp }, Player)
end

local p = Player.new("Hero", 100)
print(p:serialize())  -- {name=Hero, hp=100}
```

## Observer / EventEmitter

```lua
local EventEmitter = {}
EventEmitter.__index = EventEmitter

function EventEmitter.new()
    return setmetatable({ _listeners = {} }, EventEmitter)
end

function EventEmitter:on(event, callback)
    local list = self._listeners[event]
    if not list then
        list = {}
        self._listeners[event] = list
    end
    list[#list + 1] = callback
end

function EventEmitter:off(event, callback)
    local list = self._listeners[event]
    if not list then return end
    for i = #list, 1, -1 do
        if list[i] == callback then
            table.remove(list, i)
        end
    end
end

function EventEmitter:emit(event, ...)
    local list = self._listeners[event]
    if not list then return end
    for _, cb in ipairs(list) do
        cb(...)
    end
end

-- Usage
local bus = EventEmitter.new()
bus:on("damage", function(amount) print("Took " .. amount .. " damage") end)
bus:emit("damage", 25)
```

## State Machine

```lua
local function createStateMachine(initial, transitions)
    local current = initial
    local machine = {}

    function machine:getState()
        return current
    end

    function machine:transition(action)
        local state_transitions = transitions[current]
        if not state_transitions then
            return nil, "no transitions from state: " .. current
        end
        local next_state = state_transitions[action]
        if not next_state then
            return nil, ("no transition '%s' from state '%s'"):format(action, current)
        end
        local prev = current
        current = next_state
        return current, prev
    end

    return machine
end

local door = createStateMachine("closed", {
    closed = { open = "opened", lock = "locked" },
    opened = { close = "closed" },
    locked = { unlock = "closed" },
})

door:transition("open")   -- "opened"
door:transition("close")  -- "closed"
door:transition("lock")   -- "locked"
```

## Iterator with Coroutines (Generator Pattern)

```lua
local function range(start, stop, step)
    step = step or 1
    return coroutine.wrap(function()
        for i = start, stop, step do
            coroutine.yield(i)
        end
    end)
end

for i in range(1, 10, 2) do
    print(i)  -- 1, 3, 5, 7, 9
end

-- Tree traversal generator
local function traverseTree(node)
    return coroutine.wrap(function()
        if node.left then
            for v in traverseTree(node.left) do
                coroutine.yield(v)
            end
        end
        coroutine.yield(node.value)
        if node.right then
            for v in traverseTree(node.right) do
                coroutine.yield(v)
            end
        end
    end)
end
```

## Strategy with First-Class Functions

```lua
local sorters = {
    byName = function(a, b) return a.name < b.name end,
    byAge  = function(a, b) return a.age < b.age end,
    byScore = function(a, b) return a.score > b.score end,
}

local function sortUsers(users, strategy)
    local sorted = { table.unpack(users) }
    table.sort(sorted, sorters[strategy] or sorters.byName)
    return sorted
end

local users = {
    { name = "Alice", age = 30, score = 85 },
    { name = "Bob",   age = 25, score = 92 },
    { name = "Carol", age = 28, score = 78 },
}

local byScore = sortUsers(users, "byScore")
-- Bob (92), Alice (85), Carol (78)
```
