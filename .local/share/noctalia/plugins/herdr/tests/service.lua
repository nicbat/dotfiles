-- Run with: lua tests/service.lua /absolute/path/to/herdr
local root = assert(arg[1], "plugin directory required")
local App = assert(loadfile(root .. "/app_backend.luau"))()
local APP = "@herdr-app"
local passed = 0
local function test(name, run)
  run()
  passed = passed + 1
  print("ok " .. passed .. " - " .. name)
end
local function eq(actual, expected)
  assert(actual == expected, "expected " .. tostring(expected) .. ", got " .. tostring(actual))
end

local app = { spaces = {
  { id = "sp-local", name = "demo", tabs = {
    { id = "tb-local", name = "1 · Fix login", terminals = {
      { terminal = "t1", app = "codex", status = "working", sub_agents = {
        { terminal = "t3", app = "claude", status = "idle" },
      } },
      { terminal = "t2", app = "claude", status = "blocked" },
      { terminal = "t4" },
    } },
  } },
  { id = "remote/sp-other", name = "remote demo", machine = "remote", tabs = {
    { id = "remote/tb-other", name = "Other task", terminals = {
      { terminal = "remote/t5", app = "codex", status = "done" },
    } },
  } },
} }
local tui = { result = { snapshot = {
  workspaces = { { workspace_id = "w1", label = "TUI project" } },
  tabs = { { tab_id = "w1:t1", number = 1, label = "TUI tab" } },
  panes = { { pane_id = "w1:p1", workspace_id = "w1", tab_id = "w1:t1" } },
  agents = { { pane_id = "w1:p1", workspace_id = "w1", tab_id = "w1:t1", agent_status = "done", title = "TUI agent" } },
} } }

local function service(options)
  options = options or {}
  local queue, calls, watchers, values = {}, {}, {}, {}
  local available = { herdr = true, ["herdr-app"] = true, niri = true }
  for name, value in pairs(options.available or {}) do available[name] = value end
  local fixtures = { app = app, core = { spaces = app.spaces, window_open = false }, tui = tui, sessions = { sessions = { { name = "default", default = true, running = true } } }, machines = {}, windows = { { app_id = "herdr-app", id = 42 } } }
  local env = setmetatable({}, { __index = _G })
  env.require = function(name)
    assert(name == "./app_backend.luau")
    return App
  end
  local n = {
    string = { trim = function(s) return s:match("^%s*(.-)%s*$") end },
    json = { decode = function(s) return fixtures[s] end },
    state = {
      get = function(k) return values[k] end,
      set = function(k, v) values[k] = v end,
      watch = function(k, cb) watchers[k] = cb end,
    },
    commandExists = function(name) return available[name] == true end,
    getConfig = function(key) return key == "show_other_machines" and options.remote == true end,
    tr = function(key) return key end,
    log = function() end, notifyError = function() end,
    getenv = function() return "/home/test" end,
    setUpdateInterval = function() end,
    fileInfo = function() return nil end,
    readFile = function() return nil end,
    pluginDir = function() return root end,
    runInTerminal = function() return true end,
  }
  n.runAsync = function(argv, callback)
    table.insert(calls, argv)
    local key = table.concat(argv, " ")
    local result = { exitCode = 0, stdout = "", stderr = "" }
    if key == "herdr session list --json" then
      result.stdout = "sessions"
      if options.tuiFailure then result.exitCode = 1 end
    elseif key == "herdr api snapshot" then result.stdout = "tui"
    elseif key == "herdr machine list --json" then result.stdout = "machines"
    elseif key == "herdr-app ls" then
      result.stdout = options.badApp and "invalid" or "app"
      if options.closed then result.exitCode = 1; result.stderr = "herdr-app: no Herdr window at socket" end
    elseif argv[1] == "python3" then
      result.stdout = "core"
      if options.coreFailure then result.exitCode = 1 end
    elseif key == "niri msg -j windows" then result.stdout = "windows" end
    if callback then table.insert(queue, function() callback(result) end) end
    return true
  end
  env.noctalia = n
  local function flush()
    local limit = 100
    while #queue > 0 do
      limit = limit - 1; assert(limit > 0, "refresh loop")
      table.remove(queue, 1)()
    end
  end
  assert(loadfile(root .. "/service.luau", "t", env))()
  flush()
  return {
    state = function() return values["herdr.state"] end,
    calls = calls,
    options = options,
    refresh = function() env.update(); flush() end,
    request = function(command) watchers["herdr.command"](command); flush() end,
  }
end

test("adapter includes hidden child agents and respects remote visibility", function()
  local localOnly = App.snapshot(app, false)
  eq(#localOnly.agents, 3)
  eq(#localOnly.panes, 4)
  eq(#localOnly.workspaces, 1)
  eq(#App.snapshot(app, true).agents, 4)
  eq(App.snapshot({}, false), nil)
  assert(not App.validTerminal("w1:p1"))
  assert(not App.validTerminal("t1; rm -rf /"))
end)

test("app and TUI contribute to counts without mixing target IDs", function()
  local s = service()
  eq(s.state().running, 2)
  eq(s.state().agents, 4)
  eq(s.state().blocked, 1)
  eq(s.state().done, 1)
  eq(s.state().working, 1)
  eq(s.state().idle, 1)
end)

test("the app works when the TUI binary is absent or session listing fails", function()
  local s = service({ available = { herdr = false } })
  eq(s.state().agents, 3)
  eq(s.state().available, true)
  local failed = service({ tuiFailure = true })
  eq(failed.state().agents, 3)
  eq(failed.state().refreshing, false)
end)

test("TUI-only and closed-app states remain usable", function()
  eq(service({ available = { ["herdr-app"] = false } }).state().agents, 1)
  local s = service({ closed = true })
  eq(s.state().agents, 1)
  eq(s.state().running, 1)
  for _, row in ipairs(s.state().sessions) do
    if row.backend == "app" then eq(row.running, false); eq(row.stale, false) end
  end
end)

test("malformed app output preserves the previous snapshot as stale", function()
  local s = service()
  s.options.badApp = true
  s.refresh()
  eq(s.state().agents, 4)
  for _, row in ipairs(s.state().sessions) do
    if row.backend == "app" then eq(row.stale, true) end
  end
end)

test("closed app continues monitoring kept core terminals", function()
  local s = service({ closed = true, available = { hc = true, python3 = true } })
  eq(s.state().agents, 4)
  eq(s.state().running, 2)
  for _, row in ipairs(s.state().sessions) do
    if row.backend == "app" then eq(row.window_open, false); eq(row.stale, false) end
  end
  s.options.coreFailure = true
  s.refresh()
  eq(s.state().agents, 4)
  for _, row in ipairs(s.state().sessions) do
    if row.backend == "app" then eq(row.stale, true) end
  end
end)

test("app focus uses native terminal addresses and raises its Niri window", function()
  local s = service({ remote = true })
  s.request({ action = "focus_agent", session = APP, pane = "remote/t5" })
  local commands = {}
  for _, argv in ipairs(s.calls) do commands[table.concat(argv, " ")] = true end
  assert(commands["herdr-app do agent.focus --terminal remote/t5"])
  assert(commands["niri msg action focus-window --id 42"])
end)

test("app lifecycle actions and invalid targets cannot reach TUI commands", function()
  local s = service()
  local before = #s.calls
  s.request({ action = "stop_session", session = APP })
  s.request({ action = "delete_session", session = APP })
  s.request({ action = "focus_agent", session = APP, pane = "w1:p1" })
  eq(#s.calls, before)
end)

test("legacy focus continues to use the TUI pane ID", function()
  local s = service()
  s.request({ action = "focus_agent", session = "default", pane = "w1:p1" })
  local found = false
  for _, argv in ipairs(s.calls) do if table.concat(argv, " ") == "herdr agent focus w1:p1" then found = true end end
  assert(found)
end)

print(passed .. " tests passed")
