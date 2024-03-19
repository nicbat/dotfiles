LAZY_PLUGIN_SPEC = {}

-- this function allows us to easily add plugins to the table
function Spec(item)
	table.insert(LAZY_PLUGIN_SPEC, { import = item })
end
