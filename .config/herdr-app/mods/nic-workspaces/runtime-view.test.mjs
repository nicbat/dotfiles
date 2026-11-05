// The native checker starts with empty lists. Exercise deferred live-data rows
// and their handlers here without sending input to the person's real window.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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
  "gpui-base": 'export const v_flex = globalThis.herdrViewTest.element; export const h_flex = v_flex;',
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
  Object.assign(globalThis.herdrViewTest, { fixture, actions: [] });
  const view = new Workspaces();
  Object.assign(view, { folded: new Set(), expanded: new Set(["split"]), workers: new Set(), legacy: {} });
  return view;
}

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
