local M = {
    "nvim-treesitter/nvim-treesitter",
    build = "TSUpdate",
    -- build = function()
    --     require("nvim-treesitter.install").update({ with_sync = true })()
    -- end,
    lazy = false,
}

function M.config()
    require "nvim-treesitter.configs".setup {
        ensure_installed = { "vim", "c", "lua", "rust", "bash", "java", "latex", "markdown", "markdown_inline", "comment" },
        sync_install = true,
        auto_install = true,
        highlight = { enable = true },
        indent = { enable = true },
        autotag = {
          enable = true,
        }
    }
end

return M
