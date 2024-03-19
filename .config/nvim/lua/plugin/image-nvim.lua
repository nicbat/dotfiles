local M = {
    -- see the image.nvim readme for more information about configuring this plugin
    "3rd/image.nvim",
    opts = {
        backend = "kitty", -- whatever backend you would like to use
        max_width = 100,
        max_height = 12,
        max_height_window_percentage = math.huge,
        max_width_window_percentage = math.huge,
        window_overlap_clear_enabled = true, -- toggles images when windows are overlapped
        window_overlap_clear_ft_ignore = { "cmp_menu", "cmp_docs", "" },
    },
    lazy = false,
}

function M.config()
    -- Example for configuring Neovim to load user-installed installed Lua rocks:
    package.path = package.path .. ";" .. vim.fn.expand("$HOME") .. "/.luarocks/share/lua/5.1/?/init.lua;"
    package.path = package.path .. ";" .. vim.fn.expand("$HOME") .. "/.luarocks/share/lua/5.1/?.lua;"
end

return M
