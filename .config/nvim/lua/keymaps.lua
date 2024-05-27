local default_opts = { noremap = true, silent = true }

-- local term_opts = { silent = true }

-- Shorten function name
-- local keymap = vim.api.nvim_set_keymap

local function keymap(mode, lhs, rhs, desc)
    local mapping_opts = default_opts
    if desc and desc ~= '' then
        mapping_opts['desc'] = desc
    end
    vim.keymap.set(mode, lhs, rhs, mapping_opts)
end

local default_desc = ""

-- Modes
--   normal_mode = "n",
--   insert_mode = "i",
--   visual_mode = "v",
--   visual_block_mode = "x",
--   term_mode = "t",
--   command_mode = "c",

-- Normal --
-- Better window navigation
keymap("n", "<C-h>", "<C-w>h", default_desc)
keymap("n", "<C-j>", "<C-w>j", default_desc)
keymap("n", "<C-k>", "<C-w>k", default_desc)
keymap("n", "<C-l>", "<C-w>l", default_desc)

-- Resize with arrows
keymap("n", "<C-Up>", ":resize -2<CR>", default_desc)
keymap("n", "<C-Down>", ":resize +2<CR>", default_desc)
keymap("n", "<C-Left>", ":vertical resize -2<CR>", default_desc)
keymap("n", "<C-Right>", ":vertical resize +2<CR>", default_desc)

-- Naviagate buffers
keymap("n", "<S-l>", ":bnext<CR>", default_desc)
keymap("n", "<S-h>", ":bprevious<CR>", default_desc)

-- Move text up and down
keymap("n", "<A-j>", "<Esc>:m .+1<CR>==gi", default_desc)
keymap("n", "<A-k>", "<Esc>:m .-2<CR>==gi", default_desc)

-- Insert --
-- Press jk fast to enter
keymap("i", "jk", "<ESC>", "fast escape")

-- Visual --
-- Stay in indent mode
keymap("v", "<", "<gv", default_desc)
keymap("v", ">", ">gv", default_desc)

-- Move text up and down
keymap("v", "<A-j>", ":m .+1<CR>==", default_desc)
keymap("v", "<A-k>", ":m .-2<CR>==", default_desc)

-- Visual Block --
-- Move text up and down
keymap("x", "J", ":move '>+1<CR>gv-gv", default_desc)
keymap("x", "K", ":move '<-2<CR>gv-gv", default_desc)
keymap("x", "<A-j>", ":move '>+1<CR>gv-gv", default_desc)
keymap("x", "<A-k>", ":move '<-2<CR>gv-gv", default_desc)

-- Terminal --
-- Better terminal navigation
--keymap("t", "<C-h>", "<C-\\><C-N><C-w>h", term_opts)
--keymap("t", "<C-j>", "<C-\\><C-N><C-w>j", term_opts)
--keymap("t", "<C-k>", "<C-\\><C-N><C-w>k", term_opts)
--keymap("t", "<C-l>", "<C-\\><C-N><C-w>l", term_opts)

-- Command --
-- Menu navigation
-- keymap("c", "<C-j>",  'pumvisible() ? "\\<C-n>" : "\\<C-j>"', { expr = true, noremap = true } )
-- keymap("c", "<C-k>",  'pumvisible() ? "\\<C-p>" : "\\<C-k>"', { expr = true, noremap = true } )

-- Telescope
keymap("n", "<leader>ff", ":Telescope find_files<CR>", "find files")
keymap("n", "<leader>fg", ":Telescope live_grep<CR>", "grep files")

-- LSP Keymaps
-- I really should go through these and make sure I actually know what they mean
keymap("n", "gd", vim.lsp.buf.definition, "go to definition")
keymap("n", "K", vim.lsp.buf.hover, "show definition")
keymap("n", "<leader>vws", vim.lsp.buf.workspace_symbol, "search symbols")
keymap("n", "<leader>vd", vim.diagnostic.open_float, "open warning/error")
keymap("n", "[d", vim.diagnostic.goto_next, "go to next diagnostic")
keymap("n", "]d", vim.diagnostic.goto_prev, "go to next diagnostic")
keymap("n", "<leader>vca", vim.lsp.buf.code_action, "code actions")
keymap("n", "<leader>vrr", vim.lsp.buf.references, "find all references")
keymap("n", "<leader>vrn", vim.lsp.buf.rename, "rename all occurrences")

-- Nvim Tree
keymap("n", "<leader>e", ":NvimTreeToggle<CR>", "Open File Tree")

-- Ray Screenshot
keymap("v", "<leader>s", ":Ray<CR>", "Ray Screenshot")
