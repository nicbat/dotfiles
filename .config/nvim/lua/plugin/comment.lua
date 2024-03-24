local M = {
    'numToStr/Comment.nvim',
    lazy = false,
}

function M.config()
    require('Comment').setup({
        -- set the keybinding to <leader> '/' in normal mode
        toggler = {
            line = '<leader>/',
            --[[ block = '/', ]]
        },
        -- set the keybinding to <leader> '/' in normal and visual mode
        opleader = {
            line = '<leader>/',
            --[[ block = '/', ]]
        }
    })
end

return M
