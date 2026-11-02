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
globalThis.herdrFooterTest = { element, fixture: {}, actions: [] };
const modules = {
  "gpui-kit": 'export class View {}\nexport const div = globalThis.herdrFooterTest.element; export const svg = div; export const image = div;',
  "gpui-base": 'export const v_flex = globalThis.herdrFooterTest.element; export const h_flex = v_flex;',
  "herdr": `const test = globalThis.herdrFooterTest;
    export const spaces = () => test.fixture.spaces;
    export const panes = () => test.fixture.panes;
    export const terminals = () => test.fixture.terminals;
    export const agents = () => test.fixture.agents;
    export const window = () => ({ platform: "macos" });
    export const keys = () => [];
    export const theme = () => new Proxy({}, { get: () => "#556677" });
    export const home = () => "/home/test";
    export const run = () => { throw new Error("No workspace mutations"); };
    export const readTextFile = async path => test.fixture.records[path.split("/").pop().slice(0, -5)] ?? null;
    export const exec = async (command, args) => {
      test.calls.push([command, args]);
      if (test.fixture.failed) throw new Error("Source unavailable");
      return { code: 0, stdout: JSON.stringify({ result: { agents: test.fixture.source } }) };
    };`
};
registerHooks({
  resolve(specifier, context, next) {
    return specifier in modules ? { url: `herdr-footer-test:${specifier}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith("herdr-footer-test:") ? {
      format: "module", source: modules[url.slice("herdr-footer-test:".length)], shortCircuit: true
    } : next(url, context);
  }
});

const { default: WorkspaceStatus } = await import("./main.js");
const texts = el => typeof el === "string" ? [el] : el.items.flatMap(texts);
function setup() {
  const fixture = {
    spaces: [{ id: "s", active: true, tabs: [{ id: "tab" }] }],
    panes: ["native", "direct", "attached", "shell", "remote/attached"].map((id, i) =>
      ({ pane: `p${i}`, terminal: id, tab: "tab", program: { shell: true } })),
    agents: [{ address: "native", status: "working" }],
    terminals: [
      { address: "direct", state: "live", labels: { "herdr.codex.session": "session-a", "herdr.codex.pid": "123" },
        foreground: { name: "declawd", argv: ["declawd", "--codex"], pid: 123 } },
      ...["attached", "remote/attached"].map(address => ({ address, state: "live",
        labels: { "herdr.legacy.pane": "source-pane", "herdr.legacy.agent": "claude" },
        foreground: { name: "herdr", argv: ["herdr", "agent", "attach", "source-pane"] } })),
      { address: "shell", state: "live", title: "Working Codex", foreground: { name: "zsh" } },
      { address: "job", parent: "native", state: "live", foreground: { name: "cargo" } }
    ],
    records: { "session-a": JSON.stringify({ session_id: "session-a", state: "working" }) },
    source: [{ pane_id: "source-pane", agent: "claude", agent_status: "working" }]
  };
  Object.assign(globalThis.herdrFooterTest, { fixture, calls: [] });
  const tasks = [], timers = [];
  const cx = { timer: { every: (ms, fn) => timers.push([ms, fn]) },
    spawn: fn => tasks.push(fn(cx)), notify() {} };
  const drain = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
  const view = new WorkspaceStatus();
  view.init({}, cx);
  return { view, fixture, cx, timers, drain };
}
function label(view) { return texts(view.render()).find(text => /^\d+\/\d+ agents$/.test(text)); }
function tooltips(el) {
  return typeof el === "string" ? [] : [el.methods.tooltip?.[0], ...el.items.flatMap(tooltips)].filter(Boolean);
}

test("footer counts native, bound hooks, and fresh attachments while keeping remote status unknown", async () => {
  const { view, drain } = setup();
  await drain();
  assert.equal(label(view), "3/4 agents");
  assert.ok(tooltips(view.render()).includes("3 working · 4 open agent sessions · 1 status unavailable"));
  assert.deepEqual(globalThis.herdrFooterTest.calls, [["herdr", ["--session", "default", "agent", "list"]]]);
});

test("polls track lifecycle changes and native reports always win", async () => {
  const { view, fixture, timers, cx, drain } = setup();
  await drain();
  fixture.records["session-a"] = JSON.stringify({ session_id: "session-a", state: "done" });
  fixture.source[0].agent_status = "blocked";
  fixture.agents[0].status = "idle";
  for (const [, tick] of timers) tick(cx);
  await drain();
  assert.equal(label(view), "0/4 agents");
  assert.ok(texts(view.render()).includes("· 1 needs you"));
  fixture.agents.push({ address: "direct", status: "working" });
  assert.equal(label(view), "1/4 agents");
});

test("failed, expired, or PID-mismatched observations never retain a working count", async () => {
  const { view, fixture, cx, drain } = setup();
  await drain();
  view.legacy.default.checkedAt = Date.now() - 8001;
  assert.equal(label(view), "2/4 agents");
  fixture.failed = true;
  fixture.records = {};
  view.refreshLegacy(cx);
  view.refreshCodex(cx);
  await drain();
  assert.equal(label(view), "1/4 agents");
  fixture.records["session-a"] = JSON.stringify({ session_id: "session-a", state: "working" });
  fixture.terminals[0].foreground.pid = 456;
  view.refreshCodex(cx);
  await drain();
  assert.equal(label(view), "1/4 agents");
  assert.ok(tooltips(view.render()).some(text => text.includes("3 status unavailable")));
});

test("closed sessions leave the total; hidden reported agents count and plain jobs do not", async () => {
  const { view, fixture, cx, drain } = setup();
  await drain();
  fixture.panes = fixture.panes.filter(p => p.terminal !== "direct");
  fixture.terminals = fixture.terminals.filter(t => t.address !== "direct");
  fixture.agents.push({ address: "worker", status: "working" });
  view.refreshCodex(cx);
  await drain();
  assert.equal(label(view), "3/4 agents");
});
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
