--!nonstrict
-- HerdR panel. Process I/O lives in service.luau; UI is built by panel_view.luau.

local View = require("./panel_view.luau")

local snapshot = noctalia.state.get("herdr.state") or {
  available = false,
  refreshing = false,
  sessions = {},
  running = 0,
  agents = 0,
}
local pendingDelete = nil
local commandNonce = 0
local isOpen = false
local elapsedMs = 0
local spinnerFrame = 0

local function updateAnimation()
  panel.setNeedsFrameTick(isOpen and (tonumber(snapshot.working) or 0) > 0)
end

local function request(action, sessionName, pane)
  commandNonce = commandNonce + 1
  noctalia.state.set("herdr.command", {
    action = action,
    session = sessionName,
    pane = pane,
    nonce = commandNonce,
  })
end

function render()
  panel.render(View.build(snapshot, {
    pendingDelete = pendingDelete,
    spinnerFrame = spinnerFrame,
    setPendingDelete = function(value)
      pendingDelete = value
    end,
    request = request,
    rerender = render,
    onClose = function()
      panel.close()
    end,
  }))
end

function onOpen(_context)
  isOpen = true
  updateAnimation()
  noctalia.state.set("herdr.panel_open.attached", true)
  request("refresh")
  render()
end

function onClose()
  isOpen = false
  updateAnimation()
  pendingDelete = nil
  noctalia.state.set("herdr.panel_open.attached", false)
end

function onFrameTick(deltaMs)
  if not isOpen or (tonumber(snapshot.working) or 0) <= 0 then return end
  elapsedMs = (elapsedMs + math.max(0, tonumber(deltaMs) or 0)) % 1000
  local frame = math.floor(elapsedMs * 24 / 1000)
  if frame ~= spinnerFrame then
    spinnerFrame = frame
    render()
  end
end

noctalia.state.watch("herdr.state", function(value)
  if type(value) == "table" then
    snapshot = value
    updateAnimation()
    render()
  end
end)

render()
