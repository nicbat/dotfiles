-- Roblox Luau development: LSP (Roblox API completions/diagnostics), Treesitter, StyLua formatting.
-- No Rojo/Azul sync integration — files are edited standalone.

-- *.luau files aren't always recognized out of the box; make sure they map to the "luau" filetype.
vim.filetype.add({
  extension = {
    luau = "luau",
  },
})

return {
  -- Luau language server: Roblox API completion, diagnostics, typechecking, go-to-definition.
  -- This plugin manages the LSP client itself, so don't also register it via lspconfig/mason-lspconfig.
  {
    "lopi-py/luau-lsp.nvim",
    ft = "luau",
    opts = {
      platform = {
        type = "roblox",
      },
      sourcemap = {
        enabled = false,
      },
    },
  },

  -- Treesitter parser for Luau syntax highlighting/indentation.
  {
    "nvim-treesitter/nvim-treesitter",
    opts = function(_, opts)
      vim.list_extend(opts.ensure_installed, { "luau" })
    end,
  },

  -- Install the luau-lsp binary and StyLua formatter via Mason.
  {
    "mason-org/mason.nvim",
    opts = function(_, opts)
      vim.list_extend(opts.ensure_installed, { "luau-lsp", "stylua" })
    end,
  },

  -- Format Luau files with StyLua (Roblox's official formatter).
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        luau = { "stylua" },
      },
    },
  },
}
