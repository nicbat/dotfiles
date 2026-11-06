// Exercise the real row callbacks with App fixtures; never inject display input.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

class Element {}
function element() {
  const el = new Element();
  el.items = []; el.methods = {};
  const proxy = new Proxy(el, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => { target.methods[key === "on_mouse_down" || key === "on_mouse_up" ? `${key}:${args[0]}` : key] = args; return proxy; };
  } });
  el.child = child => { assert.ok(typeof child === "string" || child instanceof Element); el.items.push(child); return proxy; };
  el.children = children => { children.forEach(el.child); return proxy; };
  el.when = (condition, fn) => condition ? fn(proxy) : proxy;
  return proxy;
}
globalThis.dragRuntimeTest = { element };
const modules = {
  "gpui-kit": 'export class View {}\nexport const div = globalThis.dragRuntimeTest.element; export const svg = div; export const image = div;',
  "gpui-base": 'export const v_flex = globalThis.dragRuntimeTest.element; export const h_flex = v_flex; export const Scrollbar = { vertical: v_flex };',
  "herdr": `const test = globalThis.dragRuntimeTest;
    export const spaces = () => test.fixture.spaces;
    export const panes = () => test.fixture.panes;
    export const terminals = () => test.fixture.terminals;
    export const agents = () => [];
    export const focused = () => test.fixture.focus;
    export const window = () => ({ active: test.fixture.active, platform: "macos", titlebar: "native" });
    export const settings = () => ({ zoom: 1 });
    export const layout = () => test.fixture.layout ?? null;
    export const theme = () => new Proxy({}, { get: (_o, key) => key === "popover" ? "#eeffee" : key === "selected" ? "#00000022" : "#556677" });
    export const home = () => "/home/test";
    export const shared = key => test.shared[key] ?? null;
    export const setShared = (key, value) => { test.shared[key] = value; };
    export const props = () => ({});
    export const run = (command, args) => test.actions.push([command, args]);
    export const setAgentOrder = () => {};
    export const hc = () => { throw new Error("No core mutations in fixture tests"); };
    export const readTextFile = () => null;
    export const exec = async (program, args) => { test.execs.push([program, args]); return { code: 0, stdout: '{"ok":true}' }; };
    export const notify = options => test.notifications.push(options);
    export const openOverlay = options => { test.overlay = options; };
    export const nextCommand = () => new Promise(() => {});`
};
registerHooks({
  resolve(specifier, context, next) { return specifier in modules ? { url: `drag-runtime:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith("drag-runtime:") ? { format: "module", source: modules[url.slice(13)], shortCircuit: true } : next(url, context); }
});
globalThis.localStorage = { getItem: key => globalThis.dragRuntimeTest.storage?.[key] ?? null,
  setItem: (key, value) => { globalThis.dragRuntimeTest.storage[key] = value; } };
const { default: Tabs } = await import("./main.js");
const { default: Workspaces } = await import("../nic-workspaces/main.js");
const find = (node, id) => typeof node === "string" ? null : node.methods.id?.[0] === id ? node : node.items.map(child => find(child, id)).find(Boolean);
function setup() {
  const mock = globalThis.dragRuntimeTest;
  const tabs = ["a", "b", "split"].map((id, i) => ({ id, name: id, named: true, index: i + 1, active: id === "b" }));
  const panes = ["a", "b", "split"].map(id => ({ pane: `p${id}`, terminal: `t${id}`, tab: id, title: id, program: { shell: true } }));
  panes.push({ pane: "ps2", terminal: "ts2", tab: "split", title: "Second", program: { shell: true } });
  Object.assign(mock, { fixture: { spaces: [{ id: "s", name: "Project", active: true, tabs }], panes,
    terminals: panes.map((p, i) => ({ address: p.terminal, state: "live", pid: i + 1, created_ms: 10 + i, foreground: { pid: i + 100 }, program: { shell: true } })),
    focus: { pane: "pb", terminal: "tb", tab: "b", space: "s" }, active: true },
    shared: {}, storage: {}, actions: [], execs: [], notifications: [], jobs: [], timers: [] });
  const cx = { stop_propagation() {}, notify() {}, focus_handle: () => ({ focus() {}, is_focused: () => true }),
    spawn: job => mock.jobs.push(job), timer: { every() {}, after: (_ms, job) => mock.timers.push(job) } };
  const bar = new Tabs(), side = new Workspaces(); bar.init(null, cx); side.init(null, cx); side.expanded.add("split");
  return { bar, side, cx, mock };
}

test("PR toolbar button selects the shared right panel and remembers its choice alongside Files and Changes", () => {
  const { bar, cx, mock } = setup();
  const body = { id: "panel-body", active: "files", children: [{ id: "files" }, { id: "changes" }, { id: "prs" }] };
  const panel = { id: "panel", hidden: true, children: [body] };
  mock.fixture.layout = { id: "root", children: [panel] };
  mock.shared["workspace.panels"] = ["files", "changes"];
  let root = bar.render();
  assert.ok(find(root, "panel-files")); assert.ok(find(root, "panel-changes"));
  find(root, "panel-prs").methods.on_click[0](null, cx);
  assert.deepEqual(mock.actions.slice(-2), [["layout.select", { stack: "panel-body", child: "prs" }], ["layout.show", { id: "panel" }]]);
  panel.hidden = false; body.active = "prs"; root = bar.render();
  assert.equal(JSON.parse(mock.storage.panels).s, "prs");
  find(root, "panel-prs").methods.on_click[0](null, cx);
  assert.deepEqual(mock.actions.at(-1), ["layout.hide", { id: "panel" }]);
});
const event = (x, y = 15, shift = false, origin = 0, count = 1) => ({ position: { x: x + origin, y },
  local_position: { x, y }, bounds: { x: origin, y: 0, width: 100, height: 30 }, modifiers: { shift }, click_count: count });
const fire = (row, handler, e, cx) => row.methods[handler][handler.startsWith("on_mouse_down:") || handler.startsWith("on_mouse_up:") ? 1 : 0](e, cx);

test("a normal bar click selects once; a double-click renames and a close button cannot begin a drag", () => {
  const { bar, cx, mock } = setup(); let row = find(bar.render(), "tab-a");
  fire(row, "on_mouse_down:left", event(50), cx); fire(row, "on_mouse_up:left", event(50), cx);
  assert.deepEqual(mock.actions, [["tab.select", { id: "a" }]]);
  fire(row, "on_mouse_down:left", event(50, 15, false, 0, 2), cx);
  assert.deepEqual(mock.actions.at(-1), ["tab.rename", { id: "a" }]);
  row = find(bar.render(), "close-b"); fire(row, "on_mouse_down:left", event(50), cx);
  assert.equal(mock.shared["nic.tabs.drag"], null);
});

test("before/after drag uses stable IDs across reordered snapshots and never selects the drop target", () => {
  const { bar, cx, mock } = setup();
  fire(find(bar.render(), "tab-split"), "on_mouse_down:left", event(50, 15, false, 200), cx);
  mock.fixture.spaces[0].tabs.reverse();
  const row = find(bar.render(), "tab-b");
  fire(row, "on_mouse_move", event(95, 15, false, 100), cx);
  fire(row, "on_mouse_up:left", event(95, 15, false, 100), cx);
  assert.ok(mock.actions.some(([command, args]) => command === "tab.move" && args.id === "split" && args.index === 2));
  assert.ok(!mock.actions.some(([command]) => command === "tab.select"));
});

test("sidebar pane to bar tab shares the drag and invokes exactly one guarded below move", async () => {
  const { bar, side, cx, mock } = setup();
  fire(find(side.render(), "pane-ps2"), "on_mouse_down:left", event(50, 15, false, 400), cx);
  const row = find(bar.render(), "tab-b");
  fire(row, "on_mouse_move", event(50, 15, true, 100), cx);
  fire(row, "on_mouse_up:left", event(50, 15, true, 100), cx);
  assert.equal(mock.shared["nic.tabs.drag"], null);
  assert.ok(mock.shared["nic.tabs.move-busy"]);
  await mock.jobs.pop()(cx);
  assert.equal(mock.execs.length, 1);
  side.render();
  assert.ok(side.expanded.has("b"));
  side.expanded.delete("b");
  side.render();
  assert.ok(!side.expanded.has("b")); // One expansion per merge; manual collapse persists.
  const [program, args] = mock.execs[0];
  assert.equal(program, "python3"); assert.deepEqual(args.slice(1, 4), ["ts2", "pb", "down"]);
  assert.equal(JSON.parse(args[4]).source_pane, "ps2");
  assert.equal(mock.shared["nic.tabs.move-busy"], null);
  assert.equal(side.drag.blockClick(), false);
});

test("only the hovered surface draws a marker; merge keeps its title and uses an opaque direction badge", () => {
  const { bar, side, cx, mock } = setup();
  const extra = node => node.items.filter(child => typeof child !== "string" && child.methods.absolute);
  fire(find(bar.render(), "tab-a"), "on_mouse_down:left", event(50), cx);
  fire(find(bar.render(), "tab-b"), "on_mouse_move", event(95, 15, false, 100), cx);
  assert.equal(extra(find(bar.render(), "tab-b")).length, 1);
  assert.equal(extra(find(side.render(), "tab-b")).length, 0);
  fire(find(bar.render(), "tab-b"), "on_mouse_move", event(50, 15, false, 100), cx);
  const preview = extra(find(bar.render(), "tab-b"))[0];
  assert.equal(preview.methods.bg, undefined);
  assert.equal(preview.methods.border[0], 2);
  assert.equal(preview.items[0].methods.bg[0], "#eeffee");
  assert.equal(preview.items[0].items[0].items[0].methods.left[0], "50%");
  assert.ok(find(bar.render(), "tab-b").items.some(child => typeof child !== "string" && child.items.includes("b")));
  assert.equal(extra(find(side.render(), "tab-b")).length, 0);
  assert.equal(mock.shared["nic.tabs.drag"].preview.kind, "merge");
});

test("dropping beside the current position has no insertion marker or reorder action", () => {
  const { bar, side, cx, mock } = setup();
  for (const [surface, axis] of [[bar, "horizontal"], [side, "vertical"]]) {
    fire(find(surface.render(), "tab-b"), "on_mouse_down:left", event(50, 15, false, 100), cx);
    const pointer = axis === "horizontal" ? event(95) : event(50, 29);
    fire(find(surface.render(), "tab-a"), "on_mouse_move", pointer, cx);
    assert.equal(mock.shared["nic.tabs.drag"].preview.kind, "none");
    assert.ok(!find(surface.render(), "tab-a").items.some(child => typeof child !== "string" && child.methods.absolute));
    fire(find(surface.render(), "tab-a"), "on_mouse_up:left", pointer, cx);
  }
  assert.ok(!mock.actions.some(([command]) => command === "tab.move"));
});

test("the top scroll rail is hidden during a drag and returns after cancellation", () => {
  const { bar, cx } = setup();
  assert.ok(find(bar.render(), "tab-scroll").methods.overflow_x_scrollbar);
  fire(find(bar.render(), "tab-a"), "on_mouse_down:left", event(50), cx);
  fire(find(bar.render(), "tab-b"), "on_mouse_move", event(50, 15, false, 100), cx);
  const scroll = find(bar.render(), "tab-scroll");
  assert.ok(scroll.methods.overflow_x_scroll);
  assert.equal(scroll.methods.overflow_x_scrollbar, undefined);
  fire(bar.render(), "on_key_down", { key: "escape" }, cx);
  assert.ok(find(bar.render(), "tab-scroll").methods.overflow_x_scrollbar);
});

test("Shift switches the split icon; unavailable drops have no overlay or prohibited cursor and do nothing", () => {
  const { bar, cx, mock } = setup();
  fire(find(bar.render(), "tab-a"), "on_mouse_down:left", event(50), cx);
  fire(find(bar.render(), "tab-b"), "on_mouse_move", event(50, 15, true, 100), cx);
  const overlay = find(bar.render(), "tab-b").items.find(child => typeof child !== "string" && child.methods.absolute);
  assert.equal(overlay.items[0].items[0].items[0].methods.top[0], "50%");
  mock.fixture.terminals.find(t => t.address === "tb").state = "finished";
  fire(find(bar.render(), "tab-b"), "on_mouse_move", event(50, 15, true, 100), cx);
  const row = find(bar.render(), "tab-b");
  assert.equal(row.methods.cursor_not_allowed, undefined);
  assert.ok(!row.items.some(child => typeof child !== "string" && child.methods.absolute));
  fire(row, "on_mouse_up:left", event(50, 15, true, 100), cx);
  assert.equal(mock.execs.length, 0);
  assert.ok(!mock.actions.some(([command]) => command === "tab.move" || command === "tab.select"));
});

test("bar-to-sidebar center drop previews a split and suppresses activation on release", async () => {
  const { bar, side, cx, mock } = setup();
  fire(find(bar.render(), "tab-a"), "on_mouse_down:left", event(50), cx);
  const row = find(side.render(), "tab-b");
  fire(row, "on_mouse_move", event(50, 15, false, 300), cx);
  assert.equal(mock.shared["nic.tabs.drag"].preview.label, "Split right");
  fire(row, "on_mouse_up:left", event(50, 15, false, 300), cx);
  fire(row, "on_click", {}, cx);
  assert.equal(mock.actions.length, 0);
  await mock.jobs.pop()(cx);
  assert.equal(mock.execs.length, 1);
});

test("Escape, outside release, expiry and a new press cancel without a move", () => {
  for (const cancel of ["escape", "outside", "expiry", "press"]) {
    const { bar, cx, mock } = setup(); const root = bar.render();
    fire(find(root, "tab-a"), "on_mouse_down:left", event(50), cx);
    fire(find(root, "tab-b"), "on_mouse_move", event(50, 15, false, 100), cx);
    if (cancel === "escape") fire(root, "on_key_down", { key: "escape" }, cx);
    if (cancel === "outside") fire(root, "on_mouse_up:left", event(200), cx);
    if (cancel === "expiry") mock.timers.at(-1)(cx);
    if (cancel === "press") fire(root, "on_mouse_down_out", event(200), cx);
    assert.equal(mock.shared["nic.tabs.drag"], null);
    assert.ok(!mock.actions.some(([command]) => command === "tab.move"));
    assert.equal(mock.execs.length, 0);
  }
});

test("source changes, split-tab merges, window deactivation and a busy helper do not move anything", () => {
  for (const failure of ["source", "split", "inactive", "busy"]) {
    const { bar, cx, mock } = setup();
    if (failure === "busy") mock.shared["nic.tabs.move-busy"] = "other";
    fire(find(bar.render(), `tab-${failure === "split" ? "split" : "a"}`), "on_mouse_down:left", event(50), cx);
    if (failure === "source") mock.fixture.panes[0].pane = "new-pa";
    if (failure === "inactive") mock.fixture.active = false;
    const row = find(bar.render(), "tab-b");
    fire(row, "on_mouse_move", event(50, 15, false, 100), cx);
    fire(row, "on_mouse_up:left", event(50, 15, false, 100), cx);
    assert.equal(mock.execs.length, 0);
    assert.ok(!mock.actions.some(([command]) => command === "tab.select"));
    assert.equal(mock.shared["nic.tabs.drag"] ?? null, null);
  }
});

test("modifier changes update the preview at rest and an old expiry cannot cancel a new press", () => {
  const { bar, cx, mock } = setup();
  const root = bar.render();
  fire(find(root, "tab-a"), "on_mouse_down:left", event(50), cx);
  const oldTimer = mock.timers.at(-1);
  fire(find(root, "tab-b"), "on_mouse_move", event(50, 15, false, 100), cx);
  fire(root, "on_modifiers_changed", { modifiers: { shift: true } }, cx);
  assert.equal(mock.shared["nic.tabs.drag"].preview.label, "Split below");
  fire(find(root, "tab-b"), "on_mouse_down:left", event(50), cx);
  const token = mock.shared["nic.tabs.drag"].token;
  oldTimer(cx);
  assert.equal(mock.shared["nic.tabs.drag"].token, token);
});
