// Test actual input/row callbacks and durable state without real-display input.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

function element() {
  const target = { items: [], methods: {} };
  const proxy = new Proxy(target, { get(obj, key) {
    if (key === "child") return child => { obj.items.push(child); return proxy; };
    if (key === "children") return children => { obj.items.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key in obj) return obj[key];
    return (...args) => { obj.methods[key] = args; return proxy; };
  } });
  return proxy;
}
function input(options = {}) {
  let value = options.value ?? "";
  return { handlers: {}, value: () => value, set_value: next => { value = next; },
    on(event, handler) { this.handlers[event] = handler; }, focus() {} };
}
globalThis.todoViewTest = { element, input, shared: {} };
const modules = {
  "gpui-kit": "export class View {}; export const div = globalThis.todoViewTest.element; export const svg = div;",
  "gpui-base": `export const v_flex = globalThis.todoViewTest.element; export const h_flex = v_flex;
    export const InputState = { new: globalThis.todoViewTest.input };
    export const Input = { new: globalThis.todoViewTest.element };
    export const Checkbox = { new: globalThis.todoViewTest.element };
    export const Scrollbar = { vertical: globalThis.todoViewTest.element };`,
  "herdr": `const fixture = globalThis.todoViewTest;
    export const theme = () => fixture.palette ?? new Proxy({}, { get: () => "#556677" });
    export const props = () => ({ section: "todo-section" });
    export const shared = key => fixture.shared[key];
    export const setShared = (key, value) => { fixture.shared[key] = value; };`
};
registerHooks({
  resolve(specifier, context, next) { return specifier in modules ?
    { url: `todo-test:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith("todo-test:") ?
    { format: "module", source: modules[url.slice(10)], shortCircuit: true } : next(url, context); }
});
const { default: Todo } = await import("./main.js");
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({}), timer: { after: () => ({ cancel() {} }) } };
const lookup = (node, id) => typeof node === "string" ? null : node.methods.id?.[0] === id ? node :
  node.items.map(child => lookup(child, id)).find(Boolean);
let storage;
function start(fresh = true) {
  if (fresh) {
    storage = new Map();
    globalThis.todoViewTest.shared = {};
    globalThis.todoViewTest.palette = null;
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  }
  const view = new Todo();
  view.init({}, cx);
  return view;
}
function add(view, text) { view.addInput.set_value(text); view.addInput.handlers.submit({}, cx); }

test("add, complete, edit and reopen persist across a new copy with stable identities", () => {
  let view = start();
  add(view, "  Réviser 工作 🐑  ");
  add(view, "Call back\nnext week");
  const id = view.items[0].id;
  lookup(view.render(), `check-${id}`).items[0].methods.on_change[0](true, cx);
  view = start(false);
  assert.equal(view.items[0].id, id);
  assert.equal(view.items[0].done, true);
  assert.equal(view.items[0].title, "Réviser 工作 🐑");
  assert.equal(view.items[1].title, "Call back next week");
  assert.equal(globalThis.todoViewTest.shared["nic.sidebar.todo-count"], 1);
  lookup(view.render(), `title-${id}`).methods.on_click[0](null, cx);
  view.editInput.set_value("Revised task");
  assert.equal(lookup(view.render(), `delete-${id}`), undefined);
  lookup(view.render(), `save-${id}`).methods.on_click[0](null, cx);
  lookup(view.render(), `check-${id}`).items[0].methods.on_change[0](false, cx);
  view = start(false);
  assert.deepEqual(view.items[0], { id, title: "Revised task", done: false });
  assert.equal(globalThis.todoViewTest.shared["nic.sidebar.todo-count"], 2);
});

test("delete and Undo preserve the original item, completion and position", () => {
  const view = start();
  add(view, "First"); add(view, "Second"); add(view, "Third");
  const saved = structuredClone(view.items);
  lookup(view.render(), `delete-${saved[1].id}`).methods.on_click[0](null, cx);
  assert.equal(start(false).items.length, 2);
  lookup(view.render(), "undo-delete").methods.on_click[0](null, cx);
  assert.deepEqual(start(false).items, saved);
});

test("cancel and blank edits retain the saved title; empty submissions create no item", () => {
  const view = start();
  add(view, " \n ");
  assert.equal(view.items.length, 0);
  add(view, "Keep this");
  const id = view.items[0].id;
  lookup(view.render(), `title-${id}`).methods.on_click[0](null, cx);
  view.editInput.set_value(" ");
  view.editInput.handlers.submit({}, cx);
  assert.equal(view.editing, id);
  view.render().methods.on_key_down[0]({ key: "escape" }, cx);
  assert.equal(view.editing, null);
  assert.equal(start(false).items[0].title, "Keep this");
});

test("unfinished add text survives reload and only a successful submission clears it", () => {
  let view = start();
  view.addInput.set_value("Unfinished thought");
  view.addInput.handlers.change({}, cx);
  view = start(false);
  assert.equal(view.addInput.value(), "Unfinished thought");
  view.addInput.handlers.submit({}, cx);
  view = start(false);
  assert.equal(view.addInput.value(), "");
  assert.equal(view.items.length, 1);
});

test("malformed or future saved data is preserved instead of replaced with an empty list", () => {
  start();
  for (const raw of ["not JSON", '{"version":2,"items":[]}',
    '{"version":1,"items":[{"id":"a","title":"Keep","done":false},{"id":"a","title":"Duplicate","done":false}]}']) {
    storage.set("todos", raw);
    const view = start(false);
    add(view, "Must not overwrite");
    assert.ok(view.error);
    assert.equal(storage.get("todos"), raw);
    assert.equal(lookup(view.render(), "add-todo"), undefined);
  }
});

test("completed rows move below open rows without changing stored order", () => {
  const view = start();
  add(view, "Complete first"); add(view, "Still open");
  const [first, second] = view.items;
  lookup(view.render(), `check-${first.id}`).items[0].methods.on_change[0](true, cx);
  const rows = lookup(view.render(), "todo-list-content").items;
  assert.deepEqual(rows.map(row => row.methods.id[0]), [`todo-${second.id}`, `todo-${first.id}`]);
  assert.deepEqual(start(false).items.map(item => item.id), [first.id, second.id]);
});

test("layout callbacks omit a fitting scrollbar and add/remove it as content or available height changes", () => {
  const view = start();
  add(view, "A todo");
  let root = view.render();
  lookup(root, "todo-list-viewport").methods.on_size_change[0]({ height: 100 }, cx);
  lookup(root, "todo-list-content").methods.on_size_change[0]({ height: 30 }, cx);
  assert.equal(lookup(view.render(), "todo-list-scrollbar"), undefined);
  lookup(root, "todo-list-content").methods.on_size_change[0]({ height: 130 }, cx);
  root = view.render();
  assert.ok(lookup(root, "todo-list-scrollbar"));
  lookup(root, "todo-list-viewport").methods.on_size_change[0]({ height: 150 }, cx);
  assert.equal(lookup(view.render(), "todo-list-scrollbar"), undefined);
});

test("theme changes repaint open, completed and editing todos without touching saved items or draft", () => {
  const view = start();
  add(view, "Open todo"); add(view, "Completed todo"); add(view, "Editing todo");
  const [open, done, editing] = view.items;
  lookup(view.render(), `check-${done.id}`).items[0].methods.on_change[0](true, cx);
  view.edit(editing, cx);
  view.addInput.set_value("Keep this draft"); view.addInput.handlers.change({}, cx);
  const saved = [...storage];
  const roles = ["chrome", "surface", "hover", "input", "accent", "accent_foreground", "foreground", "muted", "dim", "blocked"];
  for (const [paper, ink] of [["#17191d", "#eeeeef"], ["#c0c0c0", "#000000"]]) {
    const palette = { ...Object.fromEntries(roles.map(role => [role, paper])), background: "#010203", foreground: ink, muted: ink };
    globalThis.todoViewTest.palette = palette;
    const root = view.render();
    assert.deepEqual(lookup(root, `title-${open.id}`).methods.text_color, [ink]);
    assert.deepEqual(lookup(root, `title-${done.id}`).methods.text_color, [ink]);
    assert.ok(lookup(root, `save-${editing.id}`));
    const colors = [];
    const visit = node => {
      if (typeof node === "string") return;
      for (const method of ["bg", "text_color", "border_color"]) if (node.methods[method]) colors.push(...node.methods[method]);
      if (node.methods.hover) visit(node.methods.hover[0](element()));
      node.items.forEach(visit);
    };
    visit(root);
    assert.ok(colors.every(color => Object.values(palette).includes(color)));
    assert.ok(!colors.includes(palette.background), "terminal background must not paint Todo inputs");
    assert.deepEqual([...storage], saved);
    assert.equal(view.editing, editing.id);
    assert.equal(view.addInput.value(), "Keep this draft");
  }
});
