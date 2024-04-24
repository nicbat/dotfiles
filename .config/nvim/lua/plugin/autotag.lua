local M = {
  'windwp/nvim-ts-autotag',
  lazy=false,
}

function M.config()
    require('nvim-ts-autotag').setup({
    })
end

return M
