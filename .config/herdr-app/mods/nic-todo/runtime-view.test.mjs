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
globalThis.todoViewTest = { element, input, shared: {}, files: new Map() };
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
    export const setShared = (key, value) => { fixture.shared[key] = value; };
    export const home = () => "/Users/me";
    export const readTextFile = async path => fixture.files.get(path) ?? null;
    export const writeTextFile = async (path, text, expected) => {
      fixture.beforeWrite?.(path); fixture.beforeWrite = null;
      if ((fixture.files.get(path) ?? null) !== expected) throw new Error("The file changed since it was read.");
      fixture.files.set(path, text); fixture.writes++;
    };
    export const watchFolder = () => new Promise(() => {});`
};
registerHooks({
  resolve(specifier, context, next) { return specifier in modules ?
    { url: `todo-test:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith("todo-test:") ?
    { format: "module", source: modules[url.slice(10)], shortCircuit: true } : next(url, context); }
});
const { default: Todo } = await import("./main.js");
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({}), timer: { after: () => ({ cancel() {} }) },
  spawn(body) { body(cx); }, sleep: () => new Promise(() => {}) };
// A click or key handler's context: like Herdr's, it refuses once the handler has returned,
// so work that awaits must move to cx.spawn.
function hx() {
  const own = { ...cx, dead: false,
    notify() { if (own.dead) throw new Error("This context belongs to a call that has returned."); },
    spawn(body) { if (own.dead) throw new Error("stale context"); body(cx); } };
  queueMicrotask(() => { own.dead = true; });
  return own;
}
const lookup = (node, id) => typeof node === "string" ? null : node.methods.id?.[0] === id ? node :
  node.items.map(child => lookup(child, id)).find(Boolean);
const all = (node, found = []) => {
  if (typeof node === "string") return found;
  found.push(node); node.items.forEach(child => all(child, found)); return found;
};
// The element id suffix of the row showing `title`.
const rowId = (root, title) => all(root).find(node => node.methods.id?.[0].startsWith("title-") && node.items[0] === title)
  ?.methods.id[0].slice(6);
const shown = root => all(lookup(root, "todo-list-content")).filter(node => node.methods.id?.[0].startsWith("title-"))
  .map(node => node.items[0]);
const NOTE_PATH = "/Users/me/Documents/Obsidian Vault/Todo List.md";
const NOTE = `# Work
- [ ] test 1
- [ ] test 2
## In Office
- [ ] test 5
- [ ] get tea
## WFH
- [ ] laundry

# Home
- [ ] test 3
- [ ] test 4
`;
const fixture = globalThis.todoViewTest;
let storage;
async function start(fresh = true, note = NOTE) {
  if (fresh) {
    storage = new Map();
    fixture.shared = {};
    fixture.palette = null;
    fixture.files = new Map([[NOTE_PATH, note]]);
    fixture.writes = 0;
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  }
  const view = new Todo();
  view.init({}, cx);
  await view.ready;
  return view;
}
const note = () => fixture.files.get(NOTE_PATH);
async function add(view, text) { view.addInput.set_value(text); await view.addInput.handlers.submit({}, hx()); }
const click = async (root, id) => lookup(root, id).methods.on_click[0](null, hx());
const check = async (view, title, done) => lookup(view.render(), `check-${rowId(view.render(), title)}`).items[0]
  .methods.on_change[0](done, hx());
const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("the default note shows its first heading, with labels as groups and open count published", async () => {
  const view = await start();
  const root = view.render();
  assert.deepEqual(shown(root), ["test 1", "test 2", "test 5", "get tea", "laundry"]);
  assert.ok(lookup(root, "todo-filters"));
  assert.equal(lookup(root, "todo-source").items[0].items[0], "Todo List · Work");
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 5);
  assert.equal(lookup(root, "archive-toggle"), undefined);
});

test("adding writes an unlabeled item under the heading, and the draft survives reloads until submitted", async () => {
  let view = await start();
  view.addInput.set_value("Unfinished thought");
  view.addInput.handlers.change({}, hx());
  view = await start(false);
  assert.equal(view.addInput.value(), "Unfinished thought");
  await add(view, "  Réviser 工作\n🐑  ");
  assert.equal(note(), NOTE.replace("- [ ] test 2\n", "- [ ] test 2\n- [ ] Réviser 工作 🐑\n"));
  assert.equal((await start(false)).addInput.value(), "");
  await add(view, " \n ");
  assert.equal(fixture.writes, 1);
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 6);
});

test("completing archives the item with today's date; the archive group reopens it", async () => {
  const view = await start();
  await check(view, "get tea", true);
  assert.ok(note().endsWith(`# Archive\n## Work\n- [x] get tea ✅ ${today()}\n`));
  assert.ok(!note().includes("- [ ] get tea"));
  let root = view.render();
  assert.equal(lookup(root, "archive-toggle").items[1], "Archive · 1");
  assert.ok(!shown(root).includes("get tea"));
  await click(root, "archive-toggle");
  root = view.render();
  assert.ok(shown(root).includes("get tea"));
  await check(view, "get tea", false);
  assert.ok(note().includes("- [ ] test 2\n- [ ] get tea\n## In Office"));
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 5);
});

test("editing saves to the note; escape and blank edits keep the saved title", async () => {
  const view = await start();
  await click(view.render(), `title-${rowId(view.render(), "test 1")}`);
  view.editInput.set_value(" ");
  await view.editInput.handlers.submit({}, hx());
  assert.ok(view.editing);
  view.render().methods.on_key_down[0]({ key: "escape" }, hx());
  assert.equal(view.editing, null);
  assert.equal(note(), NOTE);
  const id = rowId(view.render(), "test 1");
  await click(view.render(), `title-${id}`);
  view.editInput.set_value("Revised task");
  assert.equal(lookup(view.render(), `delete-${id}`), undefined);
  await click(view.render(), `save-${id}`);
  assert.equal(note(), NOTE.replace("test 1", "Revised task"));
});

test("delete and Undo put the exact line back", async () => {
  const view = await start();
  await click(view.render(), `delete-${rowId(view.render(), "test 5")}`);
  assert.ok(!note().includes("test 5"));
  await click(view.render(), "undo-delete");
  assert.equal(note(), NOTE);
  assert.equal(lookup(view.render(), "undo-delete"), undefined);
});

test("after a delete, other todos still complete, edit and the Undo prompt clears", async () => {
  const view = await start();
  await click(view.render(), `delete-${rowId(view.render(), "test 1")}`);
  assert.ok(lookup(view.render(), "undo-delete"));
  await check(view, "test 2", true);
  const id = rowId(view.render(), "get tea");
  await click(view.render(), `title-${id}`);
  view.editInput.set_value("green tea");
  await click(view.render(), `save-${id}`);
  await click(view.render(), "undo-delete");
  assert.equal(lookup(view.render(), "undo-delete"), undefined);
  assert.ok(note().startsWith("# Work\n- [ ] test 1\n## In Office\n- [ ] test 5\n- [ ] green tea\n"));
  assert.ok(note().includes(`## Work\n- [x] test 2 ✅ ${today()}`));
  assert.equal(view.error, null);
});

test("a label filter shows only that label's items and is remembered", async () => {
  const view = await start();
  await click(view.render(), "filter-0");
  assert.deepEqual(shown(view.render()), ["test 5", "get tea"]);
  assert.equal((await start(false)).source().filter, "In Office");
  await click(view.render(), "filter-all");
  assert.equal(shown(view.render()).length, 5);
});

test("an edit made in Obsidian while saving is kept, and the Herdr edit is applied on top", async () => {
  const view = await start();
  fixture.beforeWrite = path => fixture.files.set(path, note().replace("- [ ] test 4\n", "- [ ] test 4\n- [ ] from phone\n"));
  await check(view, "test 1", true);
  assert.ok(note().includes("- [ ] from phone"));
  assert.ok(note().includes(`- [x] test 1 ✅ ${today()}`));
  assert.ok(!note().includes("- [ ] test 1"));
  assert.equal(view.error, null);
});

test("an item changed elsewhere is reported, not guessed, and the note is left as it is", async () => {
  const view = await start();
  const changed = NOTE.replace("- [ ] test 2", "- [ ] test 2 (edited on phone)");
  fixture.beforeWrite = path => fixture.files.set(path, changed);
  await check(view, "test 2", true);
  assert.equal(note(), changed);
  assert.match(view.error, /changed in the note/);
  assert.ok(shown(view.render()).includes("test 2 (edited on phone)"));
});

test("the source menu switches headings and notes; a missing note asks for another", async () => {
  const view = await start();
  await click(view.render(), "todo-source");
  assert.equal(view.pathInput.value(), "~/Documents/Obsidian Vault/Todo List.md");
  await click(view.render(), "heading-1");
  assert.deepEqual(shown(view.render()), ["test 3", "test 4"]);
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 2);
  assert.equal((await start(false)).heading(), "Home");

  fixture.files.set("/Users/me/Notes/Other.md", "# Errands\n- [ ] post\n");
  view.pathInput.set_value("~/Notes/Missing.md");
  await view.pathInput.handlers.submit({}, hx());
  assert.match(view.error, /Couldn't find \/Users\/me\/Notes\/Missing.md/);
  assert.ok(lookup(view.render(), "todo-settings"));
  assert.equal(lookup(view.render(), "add-todo"), undefined);
  view.pathInput.set_value("~/Notes/Other.md");
  await view.pathInput.handlers.submit({}, hx());
  assert.equal(view.error, null);
  assert.deepEqual(shown(view.render()), ["post"]);
  assert.equal(note(), NOTE, "the previous note is untouched");
});

test("a heading not yet in the note is created by the first add", async () => {
  const view = await start(true, "# Home\n- [ ] a\n");
  view.chooseHeading("Work", hx());
  assert.match(all(view.render()).flatMap(node => node.items).find(item => typeof item === "string" && item.startsWith("Adding")), /creates # Work/);
  await add(view, "first");
  assert.equal(note(), "# Home\n- [ ] a\n\n# Work\n- [ ] first\n");
});

test("layout callbacks omit a fitting scrollbar and add/remove it as content or available height changes", async () => {
  const view = await start();
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

test("theme changes repaint open, archived and editing todos without touching the note or draft", async () => {
  const view = await start();
  await check(view, "test 2", true);
  await click(view.render(), "archive-toggle");
  await click(view.render(), "todo-source");
  await click(view.render(), `title-${rowId(view.render(), "test 5")}`);
  view.addInput.set_value("Keep this draft"); view.addInput.handlers.change({}, hx());
  const saved = [note(), [...storage]];
  const roles = ["chrome", "surface", "hover", "selected", "input", "accent", "accent_foreground", "foreground", "muted", "dim", "blocked"];
  for (const [paper, ink] of [["#17191d", "#eeeeef"], ["#c0c0c0", "#000000"]]) {
    const palette = { ...Object.fromEntries(roles.map(role => [role, paper])), background: "#010203", foreground: ink, muted: ink };
    fixture.palette = palette;
    const root = view.render();
    assert.deepEqual(lookup(root, `title-${rowId(root, "test 1")}`).methods.text_color, [ink]);
    assert.deepEqual(lookup(root, `title-${rowId(root, "test 2")}`).methods.text_color, [ink]);
    assert.ok(all(root).some(node => node.methods.id?.[0].startsWith("save-")));
    assert.ok(lookup(root, "todo-settings"));
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
    assert.deepEqual([note(), [...storage]], saved);
    assert.ok(view.editing);
    assert.equal(view.addInput.value(), "Keep this draft");
  }
});
