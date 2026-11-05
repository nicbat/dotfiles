export function loadTodos(raw) {
  if (raw == null) return [];
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.items)) throw new Error("Unrecognized todo data");
  const ids = new Set();
  for (const item of data.items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
        typeof item.title !== "string" || !item.title.trim() || typeof item.done !== "boolean")
      throw new Error("Invalid todo data");
    ids.add(item.id);
  }
  return data.items;
}

export const saveTodos = items => JSON.stringify({ version: 1, items });
export const titleText = value => value.replace(/[\r\n]+/g, " ").trim();
export const displayTodos = items => [...items.filter(item => !item.done), ...items.filter(item => item.done)];
