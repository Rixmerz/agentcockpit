# Lua Architecture Patterns

## ECS for Game Development

```lua
-- Entity-Component-System: data-oriented design
local World = {}
World.__index = World

function World.new()
    return setmetatable({
        entities = {},
        components = {},  -- [componentName][entityId] = data
        systems = {},
        nextId = 1,
    }, World)
end

function World:createEntity()
    local id = self.nextId
    self.nextId = id + 1
    self.entities[id] = true
    return id
end

function World:destroyEntity(id)
    self.entities[id] = nil
    for name, store in pairs(self.components) do
        store[id] = nil
    end
end

function World:addComponent(entity, name, data)
    if not self.components[name] then
        self.components[name] = {}
    end
    self.components[name][entity] = data
end

function World:getComponent(entity, name)
    local store = self.components[name]
    return store and store[entity]
end

function World:query(...)
    local required = { ... }
    return coroutine.wrap(function()
        for id in pairs(self.entities) do
            local match = true
            local result = {}
            for _, name in ipairs(required) do
                local comp = self:getComponent(id, name)
                if not comp then
                    match = false
                    break
                end
                result[name] = comp
            end
            if match then
                coroutine.yield(id, result)
            end
        end
    end)
end

function World:addSystem(system)
    self.systems[#self.systems + 1] = system
end

function World:update(dt)
    for _, system in ipairs(self.systems) do
        system(self, dt)
    end
end

-- Usage
local world = World.new()

-- Create entities
local player = world:createEntity()
world:addComponent(player, "position", { x = 100, y = 200 })
world:addComponent(player, "velocity", { vx = 50, vy = 0 })
world:addComponent(player, "sprite", { image = "player.png", w = 32, h = 32 })

local rock = world:createEntity()
world:addComponent(rock, "position", { x = 300, y = 200 })
world:addComponent(rock, "sprite", { image = "rock.png", w = 16, h = 16 })

-- Movement system: only processes entities with both position and velocity
world:addSystem(function(w, dt)
    for id, c in w:query("position", "velocity") do
        c.position.x = c.position.x + c.velocity.vx * dt
        c.position.y = c.position.y + c.velocity.vy * dt
    end
end)

-- Render system
world:addSystem(function(w, dt)
    for id, c in w:query("position", "sprite") do
        -- love.graphics.draw(c.sprite.image, c.position.x, c.position.y)
    end
end)
```

## Plugin / Extension Architecture

```lua
local PluginManager = {}
PluginManager.__index = PluginManager

function PluginManager.new()
    return setmetatable({
        plugins = {},
        hooks = {},
    }, PluginManager)
end

function PluginManager:registerHook(name)
    if not self.hooks[name] then
        self.hooks[name] = {}
    end
end

function PluginManager:addHookHandler(hookName, priority, handler)
    local hook = self.hooks[hookName]
    if not hook then
        return nil, "unknown hook: " .. hookName
    end
    hook[#hook + 1] = { priority = priority, handler = handler }
    table.sort(hook, function(a, b) return a.priority < b.priority end)
end

function PluginManager:runHook(name, ...)
    local hook = self.hooks[name]
    if not hook then return end
    local results = {}
    for _, entry in ipairs(hook) do
        local ok, result = pcall(entry.handler, ...)
        if ok then
            results[#results + 1] = result
        else
            print(("[plugin] hook '%s' error: %s"):format(name, result))
        end
    end
    return results
end

-- Sandboxed plugin loading
function PluginManager:loadPlugin(path)
    local sandbox = {
        print = print,
        pairs = pairs,
        ipairs = ipairs,
        type = type,
        tostring = tostring,
        tonumber = tonumber,
        string = string,
        table = table,
        math = math,
        -- Expose controlled API
        registerHook = function(name, priority, handler)
            self:addHookHandler(name, priority, handler)
        end,
    }
    sandbox._G = sandbox

    local chunk, err = loadfile(path, "t", sandbox)
    if not chunk then
        return nil, "failed to load plugin: " .. err
    end

    local ok, result = pcall(chunk)
    if not ok then
        return nil, "plugin error: " .. result
    end
    self.plugins[#self.plugins + 1] = { path = path, result = result }
    return true
end

-- Setup
local pm = PluginManager.new()
pm:registerHook("on_request")
pm:registerHook("on_response")
pm:registerHook("on_error")
```

## MVC with Lapis

```
my-lapis-app/
  app.lua                -- Main application, route definitions
  config.lua             -- Environment config (development, production)
  models/
    users.lua            -- Model: db schema, validations, queries
    posts.lua
  views/
    layout.etlua         -- Base HTML template
    index.etlua          -- Page templates
    users/
      show.etlua
  static/
    css/
    js/
  spec/
    models/
      users_spec.lua     -- Busted tests
  migrations.lua         -- Database migrations
  mime_types.lua
  nginx.conf             -- Generated NGINX config
```

```lua
-- app.lua
local lapis = require("lapis")
local app = lapis.Application()

app:get("/", function(self)
    return { render = "index" }
end)

app:get("/users/:id", function(self)
    local Users = require("models.users")
    self.user = Users:find(self.params.id)
    if not self.user then
        return { status = 404, render = "not_found" }
    end
    return { render = "users.show" }
end)

return app
```

## Data-Driven Design

```lua
-- Table-driven configuration with functions
local enemy_types = {
    goblin = {
        hp = 30,
        speed = 120,
        damage = 5,
        loot_table = { "gold", "dagger" },
        ai = function(self, player, dt)
            -- move toward player if close, flee if low HP
            if self.hp < 10 then
                self:fleeFrom(player, dt)
            else
                self:moveToward(player, dt)
            end
        end,
    },
    dragon = {
        hp = 500,
        speed = 80,
        damage = 50,
        loot_table = { "gold", "dragon_scale", "legendary_sword" },
        ai = function(self, player, dt)
            if self:distanceTo(player) > 200 then
                self:useBreathAttack(player)
            else
                self:meleeAttack(player)
            end
        end,
    },
}

-- Spawn from data
local function spawnEnemy(typeName, x, y)
    local template = enemy_types[typeName]
    if not template then
        return nil, "unknown enemy type: " .. typeName
    end
    return {
        type = typeName,
        x = x,
        y = y,
        hp = template.hp,
        maxHp = template.hp,
        speed = template.speed,
        damage = template.damage,
        update = template.ai,
    }
end
```

## Project Structures by Domain

### Love2D Game

```
my-game/
  main.lua               -- love.load, love.update, love.draw
  conf.lua               -- love.conf (window size, modules)
  src/
    entities/
      player.lua
      enemy.lua
    systems/
      physics.lua
      rendering.lua
      input.lua
    states/
      menu.lua
      gameplay.lua
      pause.lua
    ui/
      hud.lua
      dialog.lua
    lib/                  -- Third-party (bump, anim8, hump)
      bump.lua
      anim8.lua
  assets/
    sprites/
    audio/
    maps/                 -- Tiled .tmx files
  tests/
    test_player.lua
```

### OpenResty Application

```
my-api/
  nginx.conf             -- Main NGINX config
  lua/
    app/
      init.lua           -- Startup, shared dict init
      router.lua         -- URL routing
      middleware/
        auth.lua
        rate_limit.lua
        cors.lua
      handlers/
        users.lua
        posts.lua
      models/
        user.lua
      lib/
        db.lua           -- Connection pool wrapper
        jwt.lua
        validation.lua
    resty/               -- Custom resty modules
  conf/
    mime.types
  logs/
  t/                     -- Test::Nginx tests
    001-users.t
```

### Neovim Plugin

```
my-plugin.nvim/
  lua/
    my-plugin/
      init.lua           -- setup(), public API
      config.lua         -- Default config, merge with user config
      commands.lua       -- User commands
      health.lua         -- :checkhealth integration
      util.lua
      ui/
        float.lua        -- Floating windows
        picker.lua
  plugin/
    my-plugin.lua        -- Auto-loaded: vim.api.nvim_create_user_command
  doc/
    my-plugin.txt        -- Vimdoc help file
  tests/
    minimal_init.lua     -- Minimal config for testing
    my_plugin_spec.lua   -- Plenary/busted tests
  README.md
  stylua.toml
  .luacheckrc
```
