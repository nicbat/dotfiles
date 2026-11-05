// The native checker starts with empty lists. Exercise deferred live-data rows
// and their handlers here without sending input to the person's real window.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { draftIdentity } from "./draft-status.js";

class Element {
  constructor() {
    this.children = [];
    this.methods = {};
    return new Proxy(this, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => { target.methods[key] = args; return target.proxy; };
    } });
  }
  child(value) {
    if (typeof value !== "string" && !(value instanceof Element)) throw new Error("Invalid child");
    this.children.push(value);
    return this;
  }
  childrenOf(values) { values.forEach(v => this.child(v)); return this; }
  when(condition, fn) { return condition ? fn(this) : this; }
}
function element() {
  const el = new Element();
  el.proxy = el;
  // Match gpui-kit's children builder while retaining the recorded children.
  el.items = el.children;
  el.children = values => { values.forEach(value => el.child(value)); return el; };
  el.child = value => {
    if (typeof value !== "string" && !(value instanceof Element)) throw new Error("Invalid child");
    el.items.push(value);
    return el;
  };
  return el;
}
globalThis.herdrViewTest = { element, fixture: {}, actions: [] };
const modules = {
  "gpui-kit": 'export class View {}\nexport const div = globalThis.herdrViewTest.element; export const svg = div; export const image = div;',
  "gpui-base": 'export const v_flex = globalThis.herdrViewTest.element; export const h_flex = v_flex; export const Scrollbar = { vertical: v_flex };',
  "herdr": `const test = globalThis.herdrViewTest;
    export const spaces = () => test.fixture.spaces;
    export const panes = () => test.fixture.panes;
    export const terminals = () => test.fixture.terminals;
    export const agents = () => test.fixture.agents;
    export const focused = () => test.fixture.focus ?? null;
    export const window = () => ({ active: test.fixture.windowActive ?? true });
    export const theme = () => new Proxy({}, { get: () => "#556677" });
    export const home = () => "/home/test";
    export const shared = key => test.shared?.[key] ?? null;
    export const props = () => test.props ?? {};
    export const setShared = (key, value) => { (test.shared ??= {})[key] = value; };
    export const notify = options => { test.notification = options; };
    export const run = (command, args) => test.actions.push([command, args]);
    export const setAgentOrder = order => { test.order = order; };
    export const hc = () => { throw new Error("No core mutations in view tests"); };
    export const readTextFile = () => null;
    export const exec = () => { throw new Error("No process launch in view tests"); };
    export const openOverlay = options => { test.overlay = options; };
    export const nextCommand = () => new Promise(() => {});`
};
registerHooks({
  resolve(specifier, context, next) {
    return specifier in modules ? { url: `herdr-view-test:${specifier}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith("herdr-view-test:") ? {
      format: "module", source: modules[url.slice("herdr-view-test:".length)], shortCircuit: true
    } : next(url, context);
  }
});
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { default: Workspaces } = await import("./main.js");
const lookup = (node, id) => typeof node === "string" ? null :
  node.methods.id?.[0] === id ? node : node.items.map(n => lookup(n, id)).find(Boolean);
const texts = node => typeof node === "string" ? [node] : node.items.flatMap(texts);
function setup() {
  const fixture = {
    spaces: [{ id: "s", name: "Project", active: true, machine: null, status: null, tabs: [
      { id: "single", name: "Shell", active: false, status: null },
      { id: "split", name: "Review", active: true, status: null }] }],
    panes: [{ pane: "p0", terminal: "t0", tab: "single", title: "zsh", program: { shell: true } },
      { pane: "p1", terminal: "t1", tab: "split", title: "Agent", program: { agent: true, key: "codex" } },
      { pane: "p2", terminal: null, tab: "split", title: "Notes", mod: "markdown" }],
    terminals: [],
    agents: [{ address: "t1", pane: "p1", tab: "split", title: "Review changes", status: "blocked",
      program: { name: "Codex", key: "codex", agent: true, icon: "icons/codex.svg", tint: false } }]
  };
  Object.assign(globalThis.herdrViewTest, { fixture, actions: [], props: {} });
  const view = new Workspaces();
  Object.assign(view, { folded: new Set(), expanded: new Set(["split"]), workers: new Set(), legacy: {} });
  return view;
}

test("hovering a space replaces its count with a new-tab action and restores it on exit", () => {
  const view = setup();
  const state = globalThis.herdrViewTest;
  state.fixture.spaces.push({ id: "remote/project", name: "Other", machine: "remote", tabs: [] });
  let notifications = 0;
  const cx = { notify() { notifications++; } };
  let root = view.render();
  const count = lookup(root, "space-action-s");
  assert.deepEqual(texts(count), ["1"]);
  lookup(root, "space-s").methods.on_hover[0](true, cx);
  root = view.render();
  assert.ok(lookup(root, "space-plus-s"));
  assert.deepEqual(texts(lookup(root, "space-action-s")), []);
  assert.deepEqual(lookup(root, "space-action-s").methods.size, count.methods.size);
  assert.deepEqual(texts(lookup(root, "space-action-remote/project")), ["0"]);
  assert.equal(lookup(root, "space-action-s").methods.tooltip[0], "New tab in Project");
  // A late exit from the previous row must not hide the current row's action.
  lookup(root, "space-remote/project").methods.on_hover[0](true, cx);
  lookup(root, "space-s").methods.on_hover[0](false, cx);
  root = view.render();
  assert.deepEqual(texts(lookup(root, "space-action-s")), ["1"]);
  assert.ok(lookup(root, "space-plus-remote/project"));
  lookup(root, "space-remote/project").methods.on_hover[0](false, cx);
  root = view.render();
  assert.deepEqual(texts(lookup(root, "space-action-remote/project")), ["0"]);
  assert.equal(lookup(root, "space-plus-remote/project"), undefined);
  assert.equal(notifications, 3);
  assert.deepEqual(state.actions, []);
});

test("a folded inactive space's + opens one tab in that space without selecting the row", () => {
  const view = setup();
  const state = globalThis.herdrViewTest;
  state.fixture.spaces.push({ id: "other", name: "Other", tabs: [] });
  view.folded.add("other");
  let root = view.render();
  lookup(root, "space-other").methods.on_hover[0](true, { notify() {} });
  root = view.render();
  let stopped = false;
  const cx = { stop_propagation() { stopped = true; } };
  lookup(root, "space-action-other").methods.on_click[0](null, cx);
  if (!stopped) lookup(root, "space-other").methods.on_click[0]();
  assert.equal(stopped, true);
  assert.deepEqual(state.actions, [["tab.new", { space: "other" }]]);
  lookup(root, "space-other").methods.on_click[0]();
  assert.deepEqual(state.actions[1], ["space.select", { id: "other" }]);
  assert.ok(view.folded.has("other"));
  view.width = 100;
  assert.equal(lookup(view.render(), "space-action-other"), undefined);
});

test("inline shell badges follow leaves, collapsed splits and folded spaces without additional rows", () => {
  const view = setup();
  const f = globalThis.herdrViewTest.fixture;
  const terminal = { address: "t1", state: "live", pid: 10, foreground: { pid: 11 } };
  f.terminals = [terminal];
  view.drafts = { t1: { identity: draftIdentity(terminal), checkedAt: Date.now(), draft: true, shells: 2 } };
  let root = view.render();
  assert.deepEqual(texts(lookup(root, "background-p1")), ["2"]);
  assert.ok(lookup(lookup(root, "pane-p1"), "background-p1"));
  assert.equal(lookup(root, "pane-p1").methods.h[0], 27);
  assert.equal(lookup(root, "background-split"), undefined);
  assert.ok(texts(lookup(root, "pane-p1")).includes("Draft"));
  lookup(root, "pane-p1").methods.on_click[0]();
  assert.deepEqual(globalThis.herdrViewTest.actions, [["pane.focus", { pane: "p1" }]]);
  view.expanded.clear();
  root = view.render();
  assert.deepEqual(texts(lookup(root, "background-split")), ["2"]);
  assert.ok(lookup(lookup(root, "tab-split"), "background-split"));
  assert.equal(lookup(root, "background-p1"), undefined);
  view.folded.add("s");
  root = view.render();
  assert.deepEqual(texts(lookup(root, "background-s")), ["2"]);
  assert.ok(lookup(lookup(root, "space-s"), "background-s"));
  assert.equal(lookup(root, "background-split"), undefined);
  view.drafts.t1.checkedAt -= 9000;
  root = view.render();
  assert.equal(lookup(root, "background-s"), undefined);
});

test("sidebar reload retains the observed Codex startup; process changes renew it and removed sessions are pruned", () => {
  setup();
  const f = globalThis.herdrViewTest.fixture;
  f.terminals = [{ address: "t1", state: "live", foreground: { name: "codex", pid: 123 } }];
  const storage = new Map([["codex-starts", JSON.stringify({ t1: { pid: 123, seenAt: 1000 } })]]);
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  try {
    const view = new Workspaces();
    view.init({}, { focus_handle: () => ({}), notify() {},
      timer: { every() {}, after: () => ({ cancel() {} }) }, spawn() {} });
    assert.equal(view.codexStarts.t1.seenAt, 1000);
    assert.equal(JSON.parse(storage.get("codex-starts")).t1.seenAt, 1000);
    f.terminals[0].foreground.pid = 456;
    view.codexBusy = false;
    view.refreshCodex({ spawn() {} });
    assert.equal(JSON.parse(storage.get("codex-starts")).t1.pid, 456);
    assert.ok(view.codexStarts.t1.seenAt > 1000);
    f.terminals = [];
    view.codexBusy = false;
    view.refreshCodex({ spawn() {} });
    assert.deepEqual(JSON.parse(storage.get("codex-starts")), {});
  } finally { globalThis.localStorage = original; }
});

test("live mixed rows render valid native children and handlers focus the exact leaf or preserve split selection", () => {
  const view = setup();
  const root = view.render(); // Throws if any non-agent status is passed as child(null).
  assert.ok(texts(root).includes("Shell"));
  assert.ok(texts(root).includes("Notes"));
  lookup(root, "tab-single").methods.on_click[0]();
  lookup(root, "tab-split").methods.on_click[0]();
  lookup(root, "pane-p2").methods.on_click[0]();
  assert.deepEqual(globalThis.herdrViewTest.actions, [["pane.focus", { pane: "p0" }],
    ["space.select", { id: "s" }], ["tab.select", { id: "split" }], ["pane.focus", { pane: "p2" }]]);
});

test("a separate section header removes only the duplicate title and preserves navigation and agent order", () => {
  const view = setup();
  globalThis.herdrViewTest.props = { hideHeader: true, section: "workspace-section" };
  const root = view.render();
  assert.equal(lookup(root, "new-space"), undefined);
  assert.ok(lookup(root, "space-s"));
  assert.ok(lookup(root, "pane-p1"));
  assert.equal(globalThis.herdrViewTest.shared["nic.sidebar.workspaces-count"], 1);
  lookup(root, "pane-p2").methods.on_click[0]();
  assert.deepEqual(globalThis.herdrViewTest.actions, [["pane.focus", { pane: "p2" }]]);
});

test("disclosures fold without changing focus and retain space count and attention", () => {
  const view = setup();
  const root = view.render();
  let stopped = false;
  lookup(root, "fold-s").methods.on_click[0](null, { stop_propagation: () => { stopped = true; }, notify() {} });
  assert.ok(stopped);
  assert.deepEqual(globalThis.herdrViewTest.actions, []);
  const folded = view.render();
  assert.equal(lookup(folded, "tab-single"), undefined);
  assert.ok(texts(lookup(folded, "space-s")).includes("1"));
  assert.ok(texts(lookup(folded, "space-s")).includes("!"));
});

test("a remote attachment cannot borrow a matching local legacy snapshot", () => {
  const view = setup();
  const fixture = globalThis.herdrViewTest.fixture;
  fixture.agents = [];
  fixture.panes[1].terminal = "remote/t1";
  fixture.terminals = [{ address: "remote/t1", state: "live", labels: {
    "herdr.legacy.agent": "codex", "herdr.legacy.pane": "source" },
    foreground: { name: "herdr", argv: ["herdr", "agent", "attach", "source"] } }];
  view.legacy = { default: { checkedAt: Date.now(), agents: [{ pane_id: "source", agent: "codex", agent_status: "blocked" }] } };
  const root = view.render();
  const leaf = texts(lookup(root, "pane-p1"));
  assert.ok(leaf.includes("?"));
  assert.ok(!leaf.includes("!"));
});

test("combined rows show the bound hook state and retain native precedence", () => {
  const view = setup();
  const fixture = globalThis.herdrViewTest.fixture;
  fixture.agents = [];
  fixture.terminals = [{ address: "t1", state: "live", labels: {
    "herdr.codex.session": "session-a", "herdr.codex.pid": "123" },
    foreground: { name: "declawd", argv: ["declawd", "--codex"], pid: 123 } }];
  view.codex = { "session-a": { session_id: "session-a", state: "working" } };
  let root = view.render();
  assert.ok(!texts(lookup(root, "pane-p1")).includes("?"));
  assert.ok(lookup(root, "pane-p1").items.some(el => el.methods?.tooltip?.[0] === "Working"));
  view.codex["session-a"].state = "done";
  root = view.render();
  assert.ok(lookup(root, "pane-p1").items.some(el => el.methods?.tooltip?.[0]?.startsWith("Done — unread")));
  fixture.agents = [{ address: "t1", pane: "p1", status: "blocked" }];
  assert.ok(texts(lookup(view.render(), "pane-p1")).includes("!"));
});

test("remote Codex cannot borrow a matching local hook record", () => {
  const view = setup();
  const fixture = globalThis.herdrViewTest.fixture;
  fixture.agents = [];
  fixture.panes[1].terminal = "remote/t1";
  fixture.terminals = [{ address: "remote/t1", state: "live", labels: {
    "herdr.codex.session": "session-a", "herdr.codex.pid": "123" },
    foreground: { name: "declawd", argv: ["declawd", "--codex"], pid: 123 } }];
  view.codex = { "session-a": { session_id: "session-a", state: "working" } };
  assert.ok(texts(lookup(view.render(), "pane-p1")).includes("?"));
});

test("opening a completed agent clears its dot, while split disclosure does not mark it read", () => {
  const view = setup();
  const fixture = globalThis.herdrViewTest.fixture;
  fixture.agents[0].status = "done";
  fixture.agents[0].seq = 10;
  view.expanded.clear();
  let root = view.render();
  const cx = { stop_propagation() {}, notify() {} };
  lookup(root, "expand-split").methods.on_click[0](null, cx);
  root = view.render();
  assert.deepEqual(view.readSeen, {});
  assert.ok(lookup(root, "pane-p1").items.some(el => el.methods?.tooltip?.[0]?.startsWith("Done — unread")));
  fixture.focus = { terminal: "t1", pane: "p1" };
  root = view.render();
  assert.ok(!lookup(root, "pane-p1").items.some(el => el.methods?.tooltip?.[0]?.startsWith("Done — unread")));
  assert.equal(fixture.agents[0].status, "done"); // Never change the reporter's state.
  fixture.focus = { terminal: "t0", pane: "p0" };
  fixture.agents[0].seq = 11;
  assert.ok(lookup(view.render(), "pane-p1").items.some(el => el.methods?.tooltip?.[0]?.startsWith("Done — unread")));
});

test("idle agents keep their rows and counts without decorative status rings", () => {
  const view = setup();
  globalThis.herdrViewTest.fixture.agents[0].status = "idle";
  const root = view.render();
  assert.ok(lookup(root, "pane-p1"));
  assert.ok(!lookup(root, "pane-p1").items.some(el => ["Idle", "Done"].includes(el.methods?.tooltip?.[0])));
  assert.ok(texts(lookup(root, "space-s")).includes("1"));
});
