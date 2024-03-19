local M = {
    'nvim-lualine/lualine.nvim',
    lazy = false,
    dependencies = { 'nvim-tree/nvim-web-devicons' },
}

function M.config()
    require('lualine').setup()
end

return M
