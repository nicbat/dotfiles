local M = {
    "m4xshen/autoclose.nvim",
    lazy=false,
}

function M.config()
    require('autoclose').setup()
end

return M
