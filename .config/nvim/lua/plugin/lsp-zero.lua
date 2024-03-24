local M = {
   'VonHeikemen/lsp-zero.nvim',
   branch = "v1.x",
   dependencies = {
      -- LSP support
      'neovim/nvim-lspconfig',

      -- Autocompletetion
      'hrsh7th/nvim-cmp',
      'hrsh7th/cmp-buffer',
      'hrsh7th/cmp-path',
      'saadparwaiz1/cmp_luasnip',
      'hrsh7th/cmp-nvim-lsp',
      'hrsh7th/cmp-nvim-lua',

      -- Snippets
      'L3MON4D3/LuaSnip',
      'rafamadriz/friendly-snippets',
   },
}

function M.config()
	local lsp = require("lsp-zero")
	lsp.preset("recommended")

	lsp.set_preferences({
		suggest_lsp_servers = false,
		sign_icons = {
			error = 'E',
			warn = 'W',
			hint = 'H',
			info = 'I'
		}
	})

	require("lsp-zero").setup()
	require("mason").setup()

	require "mason-lspconfig".setup_handlers {
		function (server_name)
		    require "lspconfig" [server_name].setup {}
		end
	}

	require("mason-lspconfig").setup {
      ensure_installed = M.servers,
      automatic_installation = true,
	}

	vim.diagnostic.config({
		virtual_text = true
	})
end

return M
