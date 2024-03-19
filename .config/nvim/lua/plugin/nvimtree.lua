local M = {
    "nvim-tree/nvim-tree.lua",
    lazy = false,
}

function M.config()
    require("nvim-tree").setup()
end

return M
