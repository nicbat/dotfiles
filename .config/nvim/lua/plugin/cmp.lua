local M = {
    'hrsh7th/nvim-cmp'
}

function M.config()
    require('cmp').setup({
        -- set prefix length for completion window to show up
        completion = {
            keyword_length = 3,
        },
        -- sources = {
        --   { name = "copilot" },
        -- },
    })
end

return M
