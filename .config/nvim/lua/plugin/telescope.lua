local M = {
    "nvim-telescope/telescope.nvim",
    dependencies = { 'nvim-lua/plenary.nvim' },
    lazy = true,
    cmd = "Telescope",
}

function M.config()
    local actions = require "telescope.actions"
    require("telescope").setup {
        defaults = {
            mappings = {
                n = {
                    ["<esc>"] = actions.close,
                }
            }
        }
    }
end

return M
