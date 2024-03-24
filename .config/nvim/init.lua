require('opt')
require('launch')

vim.g.python3_host_prog = '/home/nicbat/.conda/envs/nvim-interpreter/bin/python'

-- spec plugins
Spec('plugin.colorscheme')
Spec('plugin.treesitter')
Spec('plugin.telescope')
Spec('plugin.nvim-java')
Spec('plugin.lsp-zero')
Spec('plugin.mason')
Spec('plugin.nvimtree')
Spec('plugin.cmp')
-- Jupyter Notebook stuff
-- commented for now, needs more setup
-- see https://github.com/benlubas/molten-nvim/blob/main/docs/Notebook-Setup.md for more info
-- Spec('plugin.quarto')
-- Spec('plugin.molten')

Spec('plugin.lualine')
Spec('plugin.whichkey')
Spec('plugin.comment')
Spec('plugin.gitsigns')
Spec('plugin.vimray')
-- Startup, I don't feel like using it rn
-- Spec('plugin.startup')
Spec('plugin.autoclose')
-- Terminal, might not need because of i3
-- Spec('plugin.terminal')

require('plugin.lazy')
require('keymaps')
