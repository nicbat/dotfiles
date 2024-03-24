local M = {
    'lewis6991/gitsigns.nvim'
}

function M.config()
    require('gitsigns').setup({
        current_line_blame = true,
        current_line_blame_opts = {
            delay = 500, -- default 1000
        }
    })
end

return M
