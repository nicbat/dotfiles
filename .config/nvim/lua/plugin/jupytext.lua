-- THIS FILE IS FOR MOLTEN NOTEBOOK SETUP, NOT BEING USED NOW
local M = {
    "GCBallesteros/jupytext.nvim"
}

function M.config()
    require("jupytext").setup({
        style = "markdown",
        output_extension = "md",
        force_ft = "markdown",
    })
end

return M
