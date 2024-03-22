local M = {
    "folke/which-key.nvim",
    event = "VeryLazy",
    init = function()
        vim.o.timeout = true
        vim.o.timeoutlen = 300
    end,
}

function M.config()
    local wk = require("which-key")
    wk.register({
        ["<leader>"] = {
            f = { name = "Telescope", }
        }
    })
end

return M
