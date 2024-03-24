local M = {
    "startup-nvim/startup.nvim",
    requires = {"nvim-telescope/telescope.nvim", "nvim-lua/plenary.nvim",}
}

function M.config()
    -- require('startup').setup({
        -- options = {
        --     mapping_keys = true,
        -- },
    -- })
    require('startup').setup()
end

return M
