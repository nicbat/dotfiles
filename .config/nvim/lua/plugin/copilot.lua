local M = {
  'zbirenbaum/copilot.lua',
  cmd = 'Copilot',
  event = 'InsertEnter',
}

function M.config()
  require('copilot').setup({
    suggestion = {
      enabled = true,
      auto_trigger = true,
      keymap = {
        accept = "<C-j>",
      }
    },
    -- panel = { enabled = false },
  })
end

return M
