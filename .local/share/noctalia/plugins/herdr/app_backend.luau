-- Convert the native app's spaces/tabs/terminals to the plugin's shared model.
-- Terminal addresses, not pane IDs, are the targets of app agent.focus.
local M = {}

function M.validTerminal(value)
  return type(value) == "string" and #value <= 160 and
    (value:match("^t[%w_%-]+$") ~= nil or value:match("^[%w_.%-]+/t[%w_%-]+$") ~= nil)
end

function M.snapshot(decoded, showRemote)
  if type(decoded) ~= "table" or type(decoded.spaces) ~= "table" then return nil end
  local snapshot = { workspaces = {}, tabs = {}, panes = {}, agents = {}, version = "App" }
  local seen = {}
  local count = 0
  for _, space in ipairs(decoded.spaces) do
    if type(space) == "table" and type(space.id) == "string" and
      (space.machine == nil or space.machine == "" or showRemote) then
      local label = tostring(space.name or space.id)
      if space.machine ~= nil and space.machine ~= "" then label = tostring(space.machine) .. " · " .. label end
      table.insert(snapshot.workspaces, { workspace_id = space.id, label = label })
      for _, tab in ipairs(type(space.tabs) == "table" and space.tabs or {}) do
        if type(tab) == "table" and type(tab.id) == "string" then
          table.insert(snapshot.tabs, { tab_id = tab.id, label = tostring(tab.name or "") })
          local function add(terminal)
            if type(terminal) ~= "table" or not M.validTerminal(terminal.terminal) or
              seen[terminal.terminal] or count >= 500 then return end
            seen[terminal.terminal] = true
            count = count + 1
            local title = terminal.name or tab.name or terminal.app or terminal.terminal
            local row = {
              pane_id = terminal.terminal,
              workspace_id = space.id,
              tab_id = tab.id,
              title = tostring(title),
              agent = terminal.app,
              agent_status = terminal.status == "error" and "blocked" or terminal.status,
              state_change_seq = tonumber(terminal.seq) or 0,
            }
            table.insert(snapshot.panes, row)
            if terminal.status ~= nil then table.insert(snapshot.agents, row) end
            for _, child in ipairs(type(terminal.sub_agents) == "table" and terminal.sub_agents or {}) do add(child) end
          end
          for _, terminal in ipairs(type(tab.terminals) == "table" and tab.terminals or {}) do add(terminal) end
        end
      end
    end
  end
  return snapshot
end

return M
