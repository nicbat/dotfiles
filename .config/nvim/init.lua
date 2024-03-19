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
Spec('plugin.fugitive')
-- Jupyter Notebook stuff
-- commented for now, needs more setup
-- see https://github.com/benlubas/molten-nvim/blob/main/docs/Notebook-Setup.md for more info
-- Spec('plugin.quarto')
-- Spec('plugin.molten')

Spec('plugin.lualine')
Spec('plugin.whichkey')

require('plugin.lazy')
require('keymaps')
