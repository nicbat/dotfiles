local M = {
  "zbirenbaum/copilot-cmp",
  lazy=false,
}

function M.config()
  require('copilot_cmp').setup()
end

return M
