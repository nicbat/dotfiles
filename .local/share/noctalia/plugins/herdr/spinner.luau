-- Rotated arc frames, cached per theme color; animation is panel-owned.
local M = {}
local paths = {}
local FRAME_COUNT = 24

local function frames(color)
  local hex = color:sub(1, 1) == "#" and color or noctalia.getColor(color)
  if type(hex) ~= "string" or not hex:match("^#%x%x%x%x%x%x$") then return nil end
  if paths[hex] then return paths[hex] end
  local data = noctalia.pluginDataDir()
  if not data then return nil end
  local dir = data .. "/spinners/" .. hex:sub(2)
  if not noctalia.mkdirAll(dir) then return nil end
  local result = {}
  for index = 0, FRAME_COUNT - 1 do
    local path = dir .. "/" .. tostring(index) .. ".svg"
    local svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
      .. '<path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="' .. hex
      .. '" stroke-width="2" stroke-linecap="round" transform="rotate('
      .. tostring(index * 360 / FRAME_COUNT) .. ' 12 12)"/></svg>'
    if not noctalia.writeFile(path, svg) then return nil end
    result[index + 1] = path
  end
  paths[hex] = result
  return result
end

function M.glyph(meta, size, frame)
  if meta.glyph == "loader-2" then
    local list = frames(meta.color)
    if list then
      return ui.image({ path = list[(frame or 0) % FRAME_COUNT + 1], width = size, height = size, fit = "contain" })
    end
  end
  return ui.glyph({ name = meta.glyph, size = size, color = meta.color })
end

return M
