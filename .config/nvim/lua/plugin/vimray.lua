local M = {
    "sudoerwx/vim-ray-so-beautiful"
}

function M.config()
    -- require('ray_options').setup({
    --     theme = 'candy',
    --     padding = '16',
    -- })
    -- ray_options = {
    --     theme = 'candy',
    --     padding = '16',
    -- }
    -- Unfortunately, this plugin is written in vimscript so we have to configure with vim script as well
    vim.cmd([[
        let g:ray_options = {
            \'theme' : 'candy',
            \'background' : 'true',
            \'darkMode' : 'true',
            \'padding' : '16',
            \'language' : 'auto',
        \}
    ]])
end

return M
