local M = {
	'williamboman/mason.nvim',
	dependencies = {
      'williamboman/mason-lspconfig.nvim',
      'nvim-lua/plenary.nvim',
	},
    servers = {}
}

M.servers = {
    --"lua_ls",
	"rust_analyzer",
	"clangd",
    'jdtls',
    'pyright',
--    'marksman',
}

function M.config()

	local lsp = require("lsp-zero")
	lsp.preset("recommended")

	require("lsp-zero").setup()
	require("mason").setup()

	require("mason-lspconfig").setup_handlers({
		function (server_name)
		    require("lspconfig")[server_name].setup {}
		end,
        -- custom handlers below
        ["lua_ls"] = function ()
           local lspconfig = require("lspconfig")
           lspconfig.lua_ls.setup {
               settings = {
                   Lua = {
                       diagnostics = {
                           globals = { "vim", "quarto" }
                       }
                   }
               }
           }
        end,
        -- for quarto and ipynb files
        ["marksman"] = function ()
            local lspconfig = require("lspconfig")
            local util = require("lspconfig.util")
            lspconfig.marksman.setup {
                filetypes = { 'markdown', 'quarto' },
                root_dir = util.root_pattern('.git', '.marksman.toml', '_quarto.yml'),
            }
        end,

        -- may have to copy the pyright files too
	})

	require("mason-lspconfig").setup {
      ensure_installed = M.servers,
      automatic_installation = true,
	}

end

return M
