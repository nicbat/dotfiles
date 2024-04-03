local g = vim.g
local opt = vim.opt

g.mapleader = " "
opt.nu = true

opt.tabstop = 2
opt.softtabstop = 2
opt.shiftwidth = 2
opt.expandtab = true
opt.smartindent = true

opt.wrap = true

opt.swapfile = false
opt.backup = false
opt.undofile = true

opt.undodir = os.getenv("HOME") .. "/.vim/undodir"

opt.scrolloff = 9
opt.signcolumn = "yes"
--opt.colorcolumn = "80"
opt.cursorline = true
opt.updatetime = 50
