-- local M = {
--     "catppuccin/nvim",
--     lazy = false,
--     priority = 1000,
-- }
--
-- function M.config()
--     vim.cmd.colorscheme "catppuccin-mocha"
-- end
--
-- return M

local M = {
  "sainnhe/everforest",
  lazy = false,
  priority = 1000,
}

function M.config()
  vim.g.everforest_background = "hard" -- "hard" or "medium" or "soft"
  vim.g.everforest_better_performance = 1
  vim.cmd.colorscheme "everforest"
end

return M
