// The Todoist view's real handlers and the Source switcher, with stand-in Herdr modules,
// a fake API and a fake Keychain.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

function element() {
  const target = { items: [], methods: {} };
  const proxy = new Proxy(target, { get(obj, key) {
    if (key === "child") return child => { obj.items.push(child); return proxy; };
    if (key === "children") return children => { obj.items.push(...children); return proxy; };
    if (key === "trigger" || key === "content") return child => { obj.items.push(child); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key in obj) return obj[key];
    return (...args) => { obj.methods[key] = args; return proxy; };
  } });
  return proxy;
}
globalThis.todoistViewTest = { element, shared: {}, store: new Map() };
globalThis.localStorage = { getItem: k => globalThis.todoistViewTest.store.get(k) ?? null,
  setItem: (k, v) => globalThis.todoistViewTest.store.set(k, String(v)) };
const modules = {
  "gpui-kit": "export class View {}; export const div = globalThis.todoistViewTest.element; export const svg = div;",
  "gpui-base": `export const v_flex = globalThis.todoistViewTest.element; export const h_flex = v_flex;
    export const InputState = { new: () => { let value = ""; const handlers = {};
      return { handlers, on(e, h) { handlers[e] = h; }, value: () => value, set_value(v) { value = v; }, focus() {},
        set_masked(m) { this.masked = m; } }; } };
    export const Input = { new: globalThis.todoistViewTest.element };
    export const Checkbox = { new: globalThis.todoistViewTest.element };
    export const Popover = { new: id => globalThis.todoistViewTest.element().id(id) };
    export const TextareaState = { new: () => { let value = ""; return { on() {}, value: () => value, set_value(v) { value = v; },
      focus() {}, set_auto_grow() {} }; } };
    export const Textarea = { new: globalThis.todoistViewTest.element };
    export const Scrollbar = { vertical: globalThis.todoistViewTest.element };`,
  "herdr": `const fixture = globalThis.todoistViewTest;
    export const theme = () => new Proxy({}, { get: (_t, k) => String(k) });
    export const props = () => ({ section: "todo-section" });
    export const shared = key => fixture.shared[key];
    export const setShared = (key, value) => { fixture.shared[key] = value; };
    export const home = () => "/Users/me";
    export const run = () => {};
    export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
    export const checking = () => false;
    export const readTextFile = async () => null;
    export const writeTextFile = async () => null;
    export const watchFolder = () => new Promise(() => {});
    export const settings = () => ({ zoom: 1 });
    export const appHome = () => "/Users/me/.config/herdr-app";`
};
registerHooks({
  resolve(specifier, context, next) { return specifier in modules ?
    { url: `todoist-test:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith("todoist-test:") ?
    { format: "module", source: modules[url.slice(13)], shortCircuit: true } : next(url, context); }
});
const fixture = globalThis.todoistViewTest;
const { default: TodoistTodo, deps } = await import("./todoist-view.js");
const { default: Todo } = await import("./main.js");

const made = [];
const timers = [];
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({}),
  timer: { after: (ms, fn) => { const task = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(task); return task; },
    every: () => ({ cancel() {} }) },
  spawn(body) { return body(cx); }, sleep: () => new Promise(() => {}),
  new(Class, props) { const entity = { Class, props, released: false, release() { this.released = true; return true; } };
    made.push(entity); return entity; } };
const all = (node, found = []) => {
  if (!node || typeof node !== "object") return found;
  found.push(node); (node.items ?? []).forEach(child => all(child, found)); return found;
};
const lookup = (root, id) => all(root).find(node => node.methods?.id?.[0] === id);
const texts = root => all(root).flatMap(node => (node.items ?? []).filter(i => typeof i === "string"));
const titles = root => all(lookup(root, "todo-list-content")).filter(n => n.methods?.id?.[0].startsWith("title-")).map(n => n.items[0]);
const click = (root, id) => lookup(root, id).methods.on_click[0]({}, cx);

let key = "fake-key";
let failNext = null;
const calls = [];
const makeTasks = () => ({
  today: [{ id: "a", content: "Ship it", project_id: "p1", priority: 4, due: { date: "2000-01-01", string: "Jan 1 2000" }, labels: ["deep"] },
    { id: "b", content: "Tea", project_id: "p1", due: null, labels: [] }],
  p1: [{ id: "c", content: "Plan", project_id: "p1", section_id: "s1", child_order: 1, labels: [] },
    { id: "d", content: "Sub", project_id: "p1", section_id: "s1", parent_id: "c", labels: [] },
    { id: "e", content: "Loose", project_id: "p1", section_id: null, labels: [] }],
  in: []
});
let TASKS = makeTasks();
let failWrites = false;
const everyTask = () => Object.values(TASKS).flat();
const routes = {
  "/projects": () => [{ id: "in", name: "Inbox", inbox_project: true }, { id: "p1", name: "Work" }],
  "/labels": () => [{ id: "l1", name: "deep" }],
  "/sections": () => [{ id: "s1", name: "This week", section_order: 1 }],
  "/tasks": params => TASKS[params.get("project_id")] ?? [],
  "/tasks/filter": params => params.get("query") === "today | overdue"
    ? [...TASKS.today, ...everyTask().filter(t => t.due && !TASKS.today.includes(t))] : TASKS.p1.slice(0, 1)
};
const dueFrom = text => text === "no date" ? null : { string: text, date: text === "today" ? "2026-11-19" : "2026-11-20" };
// Writes: change the fake account so the next load sees them.
function write(method, path, body) {
  if (failWrites) return { status: 500, ok: false, text: async () => "boom" };
  const ok = value => ({ status: value === undefined ? 204 : 200, ok: true, json: async () => value ?? null });
  let m;
  if ((m = /^\/tasks\/([^/]+)\/(close|reopen)$/.exec(path))) {
    // Like Todoist: closing a repeating task moves it to its next date instead.
    everyTask().filter(t => t.id === m[1]).forEach(t => {
      if (m[2] === "close" && t.due?.is_recurring) t.due = { ...t.due, date: "2026-11-20" };
      else t.checked = m[2] === "close";
    });
    return ok();
  }
  if (path === "/tasks/quick") {
    const task = { id: `n${everyTask().length}`, content: body.text, project_id: "in", labels: [], due: null };
    TASKS.in.push(task);
    return ok(task);
  }
  if ((m = /^\/tasks\/([^/]+)$/.exec(path))) {
    const task = everyTask().find(t => t.id === m[1]);
    const { due_string, ...rest } = body;
    Object.assign(task, rest, due_string !== undefined ? { due: dueFrom(due_string) } : {});
    return ok({ ...task });
  }
  return { status: 404, ok: false, text: async () => "" };
}
deps.exec = async (command, args) => {
  calls.push([command, ...args]);
  if (command === "security" && args[0] === "add-generic-password") { key = args.at(-1); return { code: 0, stdout: "", stderr: "" }; }
  if (command === "security") return key ? { code: 0, stdout: `${key}\n`, stderr: "" } : { code: 44, stdout: "", stderr: "" };
  if (command === "secret-tool") return key ? { code: 0, stdout: `${key}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
  if (command === "sh") { key = written.get(args[3]); return { code: 0, stdout: "", stderr: "" }; }
  return { code: 0, stdout: "", stderr: "" };
};
deps.request = async (url, options) => {
  const u = new URL(url);
  calls.push(["fetch", u.pathname + u.search, options.headers.Authorization]);
  if (options.headers.Authorization !== "Bearer fake-key") return { status: 401, ok: false, text: async () => "" };
  if (failNext) { const status = failNext; failNext = null; return { status, ok: false, text: async () => "" }; }
  const path = u.pathname.replace("/api/v1", "");
  if (options.method === "POST" && path !== "/sync") {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push(["write", path, body]);
    return write(options.method, path, body);
  }
  if (path === "/sync") return { status: 200, ok: true,
    json: async () => ({ filters: [{ id: "f1", name: "Deep work", query: "@deep", item_order: 1 }] }) };
  return { status: 200, ok: true, json: async () => ({ results: routes[path](u.searchParams), next_cursor: null }) };
};
deps.now = () => new Date(2026, 10, 19, 12);
let os = "macos"; // what Herdr reports on a Mac
deps.os = () => os;
const written = new Map();
deps.writeFile = async (path, text) => { written.set(path, text); };

function fresh() {
  TASKS = makeTasks();
  failWrites = false;
  fixture.shared = {};
  fixture.store.clear();
  calls.length = 0;
  key = "fake-key";
  const view = new TodoistTodo();
  view.init({}, cx);
  return view;
}

test("without a saved key it explains the Keychain command and shows no count", async () => {
  key = null;
  fixture.shared = {}; fixture.store.clear(); calls.length = 0;
  const view = new TodoistTodo(); view.init({}, cx);
  await view.ready;
  const root = view.render();
  assert.ok(lookup(root, "todoist-save-key"), "a paste-and-save field");
  assert.ok(view.keyInput.masked, "the key field is masked");
  assert.ok(!calls.some(c => c[0] === "fetch"), "no API calls without a key");
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 0);
  key = "fake-key";
  await click(root, "todoist-check-key");
  await view.ready;
  assert.equal(view.error, null);
  assert.deepEqual(titles(view.render()), ["Ship it", "Tea"]);
});

for (const platform of ["macos", "linux"]) test(`${platform}: a pasted key is checked with Todoist, then saved to the keychain`, async () => {
  os = platform; key = null;
  fixture.shared = {}; fixture.store.clear(); calls.length = 0; written.clear();
  const view = new TodoistTodo(); view.init({}, cx);
  await view.ready;
  view.keyInput.set_value("wrong-key");
  await view.saveKey(cx);
  assert.match(view.keyNote, /didn't accept/);
  assert.equal(key, null, "a rejected key is not saved");
  view.keyInput.set_value("  fake-key  ");
  await view.saveKey(cx);
  await view.ready;
  assert.equal(key, "fake-key", "saved where the keychain read finds it");
  assert.equal(view.keyInput.value(), "", "the field is cleared");
  assert.equal(view.error, null);
  assert.deepEqual(titles(view.render()), ["Ship it", "Tea"]);
  if (platform === "linux") {
    assert.ok(calls.some(c => c[0] === "install" && c.at(-1) === "/Users/me/.config/herdr-app/data/nic-todo-key"));
    assert.deepEqual(calls.find(c => c[0] === "rm"), ["rm", "-f", "/Users/me/.config/herdr-app/data/nic-todo-key/key"]);
    assert.ok(!calls.some(c => c[0] !== "fetch" && c.includes("fake-key")), "never a command argument on Linux");
  }
  os = "macos";
});

test("Linux without secret-tool says what to install", async () => {
  os = "linux";
  fixture.shared = {}; fixture.store.clear(); calls.length = 0;
  const saved = deps.exec;
  deps.exec = async command => { if (command === "secret-tool") throw new Error("not installed"); return saved(command, []); };
  const view = new TodoistTodo(); view.init({}, cx);
  await view.ready;
  assert.equal(view.error.kind, "nokeystore");
  assert.ok(texts(view.render()).some(s => s.includes("libsecret-tools")));
  deps.exec = saved; os = "macos";
});

test("Today loads with the key, shows overdue first and publishes the count", async () => {
  const view = fresh();
  await view.ready;
  const root = view.render();
  assert.deepEqual(titles(root), ["Ship it", "Tea"]);
  assert.ok(texts(root).includes("Overdue") && texts(root).includes("Todoist · Today"));
  assert.ok(calls.filter(c => c[0] === "fetch").every(c => c[2] === "Bearer fake-key"));
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 2);
  assert.ok(fixture.store.get("todoist-cache").includes("Ship it"));
});

test("the picker lists views, saved filters, projects and labels; choosing one reloads", async () => {
  const view = fresh();
  await view.ready;
  view.choosing = true;
  let root = view.render();
  const shown = texts(lookup(root, "todoist-picker"));
  for (const label of ["Obsidian note", "Todoist", "Today", "Upcoming", "Inbox", "Deep work", "Work", "@deep"])
    assert.ok(shown.includes(label), `picker shows ${label}`);
  assert.equal(shown.filter(s => s === "Inbox").length, 1, "the Inbox project is the Inbox view, not listed twice");
  const project = all(lookup(root, "todoist-picker")).find(n => n.methods?.id?.[0]?.startsWith("project-"));
  project.methods.on_click[0]({}, cx);
  await view.ready;
  assert.deepEqual(fixture.shared["nic.todo.todoist"].view, { kind: "project", id: "p1", name: "Work" });
  root = view.render();
  assert.deepEqual(titles(root), ["Loose", "Plan", "Sub"]);
  assert.ok(texts(root).includes("This week"));
  // Section chips filter like the Obsidian labels.
  assert.equal(lookup(root, "todo-filters"), undefined, "one section: no chips");
  assert.equal(lookup(view.render(), "todoist-picker"), undefined, "picker closed after choosing");
});

test("a saved filter runs its own query", async () => {
  const view = fresh();
  await view.ready;
  view.choose({ kind: "filter", id: "f1", name: "Deep work", query: "@deep" }, cx);
  await view.ready;
  assert.ok(calls.some(c => c[0] === "fetch" && c[1] === "/api/v1/tasks/filter?query=%40deep&limit=200"));
  assert.deepEqual(titles(view.render()), ["Plan"]);
});

test("a rejected key keeps the last list, says so, and reads the Keychain again next time", async () => {
  const view = fresh();
  await view.ready;
  failNext = 401;
  await view.refresh(cx);
  await view.ready;
  assert.equal(view.error.kind, "auth");
  assert.deepEqual(titles(view.render()), ["Ship it", "Tea"]);
  assert.ok(texts(view.render()).some(s => s.startsWith("Todoist rejected the saved API key")));
  assert.ok(lookup(view.render(), "todoist-save-key"), "offers to paste a new key");
  const reads = calls.filter(c => c[0] === "security").length;
  await view.refresh(cx);
  await view.ready;
  assert.equal(calls.filter(c => c[0] === "security").length, reads + 1);
  assert.equal(view.error, null);
});

const rowOf = (root, title) => all(root).find(n => n.methods?.on_open_change && texts(n).includes(title));
const writes = () => calls.filter(c => c[0] === "write").map(c => [c[1], c[2]]);
const openRow = (view, title) => rowOf(view.render(), title).methods.on_open_change[0](true, cx);

test("clicking a task opens the editor; Open in Todoist opens the desktop app", async () => {
  const view = fresh();
  await view.ready;
  openRow(view, "Ship it");
  assert.equal(view.editing, "a");
  assert.equal(view.editTitle.value(), "Ship it");
  assert.equal(view.editDue.value(), "Jan 1 2000");
  assert.equal(view.editPriority, 4);
  const root = view.render();
  assert.ok(lookup(root, "todoist-editor"), "the editor shows");
  click(root, "todoist-open");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(view.editing, null);
  assert.deepEqual(calls.at(-1), ["open", "todoist://task?id=a"]);
});

test("saving sends only what changed; an untouched date keeps its repeat, an emptied one clears", async () => {
  const view = fresh();
  await view.ready;
  openRow(view, "Ship it");
  view.editTitle.set_value("Ship it today");
  click(view.render(), "priority-2");
  await view.saveEdit(cx);
  assert.deepEqual(writes(), [["/tasks/a", { content: "Ship it today", priority: 2 }]]);
  assert.ok(titles(view.render()).includes("Ship it today"));
  calls.length = 0;
  openRow(view, "Ship it today");
  view.editDue.set_value("");
  view.editDesc.set_value("notes");
  await view.saveEdit(cx);
  assert.deepEqual(writes(), [["/tasks/a", { description: "notes", due_string: "no date" }]]);
  calls.length = 0;
  openRow(view, "Tea");
  await view.saveEdit(cx);
  assert.deepEqual(writes(), [], "no change, no request");
  openRow(view, "Tea");
  view.editTitle.set_value("  ");
  view.saveEdit(cx);
  assert.equal(view.editError, "A task needs a name.");
  assert.equal(view.editing, "b", "stays open to fix");
});

test("a failed save puts the old title back and says so", async () => {
  const view = fresh();
  await view.ready;
  openRow(view, "Tea");
  view.editTitle.set_value("Coffee");
  failWrites = true;
  await view.saveEdit(cx);
  await view.ready;
  assert.ok(titles(view.render()).includes("Tea"));
  assert.match(view.notice, /^Saving “Coffee” failed: Todoist answered 500/);
  assert.ok(lookup(view.render(), "todoist-notice"), "shown above the list");
});

test("the ring completes at once, with Undo; a parent takes its subtasks", async () => {
  const view = fresh();
  await view.ready;
  click(view.render(), "ring-" + all(view.render()).find(n => n.methods?.id?.[0]?.startsWith("ring-")).methods.id[0].slice(5));
  await view.ready;
  assert.deepEqual(writes(), [["/tasks/a/close", null]]);
  assert.deepEqual(titles(view.render()), ["Tea"]);
  assert.equal(fixture.shared["nic.sidebar.todo-count"], 1);
  assert.ok(texts(view.render()).includes("Completed “Ship it”"));
  await click(view.render(), "undo-complete");
  await view.ready;
  assert.deepEqual(writes().at(-1), ["/tasks/a/reopen", null]);
  assert.deepEqual(titles(view.render()), ["Ship it", "Tea"]);
  view.choose({ kind: "project", id: "p1", name: "Work" }, cx);
  await view.ready;
  const plan = view.shown().groups.flatMap(g => g.items).find(i => i.title === "Plan");
  view.complete(plan, cx);
  assert.deepEqual(titles(view.render()), ["Loose"], "hidden before Todoist answers");
  await view.ready;
  assert.deepEqual(titles(view.render()), ["Loose"]);
});

test("the Completed bar goes away by itself, or with its ×", async () => {
  const view = fresh();
  await view.ready;
  view.complete(view.shown().groups.flatMap(g => g.items).find(i => i.title === "Ship it"), cx);
  await view.ready;
  const timer = timers.at(-1);
  assert.equal(timer.ms, 8000);
  timer.fn(cx);
  assert.equal(view.completed, null);
  assert.equal(lookup(view.render(), "undo-complete"), undefined);
  view.complete(view.shown().groups.flatMap(g => g.items).find(i => i.title === "Tea"), cx);
  await view.ready;
  assert.ok(lookup(view.render(), "completed-close"));
  await click(view.render(), "completed-close");
  assert.equal(view.completed, null);
  assert.ok(timers.at(-1).cancelled, "the pending dismiss is cancelled");
});

test("a failed completion brings the task back; a repeating one is not hidden", async () => {
  const view = fresh();
  await view.ready;
  failWrites = true;
  const ship = view.shown().groups.flatMap(g => g.items).find(i => i.title === "Ship it");
  await view.complete(ship, cx);
  await view.ready;
  assert.deepEqual(titles(view.render()), ["Ship it", "Tea"]);
  assert.match(view.notice, /^Completing failed/);
  assert.equal(view.completed, null);
  failWrites = false;
  TASKS.today[1].due = { date: "2026-11-19", string: "every day", is_recurring: true };
  await view.refresh(cx);
  const tea = view.shown().groups.flatMap(g => g.items).find(i => i.title === "Tea");
  await view.complete(tea, cx);
  await view.ready;
  assert.ok(titles(view.render()).includes("Tea"), "stays, on its next date");
  assert.ok(texts(view.render()).includes("Tomorrow ↻"));
  assert.equal(lookup(view.render(), "undo-complete"), undefined);
});

test("adding uses Quick Add, placed by the view", async () => {
  const view = fresh();
  await view.ready;
  view.addInput.set_value("Call mom");
  await view.add(cx);
  await view.ready;
  assert.deepEqual(writes()[0], ["/tasks/quick", { text: "Call mom" }]);
  assert.deepEqual(writes()[1], [`/tasks/${writes()[1][0].split("/")[2]}`, { due_string: "today" }], "Today dates it today");
  assert.ok(titles(view.render()).includes("Call mom"));
  assert.equal(view.addNote, null);
  assert.equal(view.addInput.value(), "");
  view.choose({ kind: "project", id: "p1", name: "Work" }, cx);
  await view.ready;
  view.setState({ filter: "This week" });
  calls.length = 0;
  view.addInput.set_value("Draft memo tomorrow");
  await view.add(cx);
  await view.ready;
  assert.deepEqual(writes(), [["/tasks/quick", { text: "Draft memo tomorrow #Work /This\\ week" }]]);
  assert.equal(view.addNote, "Added to Inbox; it isn't in this view.", "the fake puts every add in the Inbox");
  failWrites = true;
  view.addInput.set_value("Keep me");
  await view.add(cx);
  assert.equal(view.addInput.value(), "Keep me", "a failed add keeps the text");
});

test("the Todo section mounts the chosen source and swaps when it changes", () => {
  fixture.shared = {};
  made.length = 0;
  const todo = new Todo();
  todo.init({}, cx);
  assert.equal(made.length, 1);
  assert.equal(made[0].Class.name, "ObsidianTodo");
  assert.equal(fixture.shared["nic.sidebar.todo-link"], null, "no Todoist button for the note");
  todo.mount(cx);
  assert.equal(made.length, 1, "no remount while unchanged");
  fixture.shared["nic.todo.backend"] = "todoist";
  todo.mount(cx);
  assert.equal(made[0].released, true);
  assert.equal(made[1].Class.name, "TodoistTodo");
  assert.deepEqual(made[1].props, { section: "todo-section" });
  assert.deepEqual(fixture.shared["nic.sidebar.todo-link"].urls, ["todoist://", "https://app.todoist.com/app"]);
  assert.equal(todo.render().items[0], made[1]);
});
