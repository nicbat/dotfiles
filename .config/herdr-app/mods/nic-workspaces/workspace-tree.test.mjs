import test from "node:test";
import assert from "node:assert/strict";
import { workspaceTree, activation, urgent, workerTree, agentOrder } from "./workspace-tree.js";
import { visibleAgents } from "./visible-agents.js";

const program = { key: "codex", name: "Codex", agent: true };
const tab = (id, name = id) => ({ id, name, index: 1, status: null });
const space = (tabs, id = "s1") => ({ id, name: id, tabs, status: null });
const pane = (id, tab, terminal = id) => ({ pane: id, tab, terminal, title: id,
  program: { key: "shell", name: "zsh", shell: true } });
const agent = (p, status = "unknown") => ({ address: p.terminal, pane: p.pane,
  tab: p.tab, title: "Implement feature | repo", program, status });

test("shell, editor, settled and document tabs remain in their original order without agents", () => {
  const tabs = [tab("shell", "Shell"), tab("edit", "Model configuration — nvim"),
    { ...tab("notes", "Notes"), settled: true }, tab("empty", "Connecting")];
  const ps = [pane("p1", "shell"), { ...pane("p2", "edit"), program: { name: "Neovim" } },
    { ...pane("p3", "notes", null), mod: "markdown", program: undefined }];
  const [s] = workspaceTree([space(tabs)], ps, [], []);
  assert.deepEqual(s.tabs.map(t => t.id), tabs.map(t => t.id));
  assert.equal(s.agentCount, 0);
  assert.equal(s.paneCount, 3);
  assert.ok(s.tabs.every(t => t.status === null));
  assert.deepEqual(s.tabs[2].actions, [["pane.focus", { pane: "p3" }]]);
  assert.equal(s.tabs[2].title, "Notes");
  assert.equal(s.tabs[3].single, null);
});

test("a mixed split retains shell, agent and mod panes with exact independent targets", () => {
  const ps = [pane("shell", "t"), pane("agent", "t"), { ...pane("doc", "t", null), mod: "markdown" }];
  const [s] = workspaceTree([space([tab("t", "Review")])], ps, [], [agent(ps[1], "working")]);
  assert.deepEqual(s.tabs[0].leaves.map(p => p.id), ["shell", "agent", "doc"]);
  assert.equal(s.tabs[0].single, null);
  assert.equal(s.tabs[0].agentCount, 1);
  assert.deepEqual(s.tabs[0].leaves.map(p => p.status), [null, "working", null]);
  assert.deepEqual(s.tabs[0].actions, [["space.select", { id: "s1" }], ["tab.select", { id: "t" }]]);
  for (const p of s.tabs[0].leaves) assert.deepEqual(p.actions, [["pane.focus", { pane: p.id }]]);
});

test("compact single-agent rows preserve meaningful tab names and pane focus", () => {
  const p = pane("p", "t");
  const [s] = workspaceTree([space([tab("t", "Fix the parser")])], [p], [], [agent(p)]);
  assert.equal(s.tabs[0].title, "Fix the parser");
  assert.equal(s.tabs[0].single.title, "Fix the parser");
  assert.deepEqual(s.tabs[0].actions, [["pane.focus", { pane: "p" }]]);
  assert.equal(s.tabs[0].status, "unknown");
});

test("an agent beside a document uses its task title independently of the shared tab name", () => {
  const p = pane("agent", "t");
  const doc = { ...pane("doc", "t", null), mod: "markdown" };
  const [s] = workspaceTree([space([tab("t", "Design notes")])], [p, doc], [], [agent(p)]);
  assert.equal(s.tabs[0].title, "Design notes");
  assert.equal(s.tabs[0].leaves[0].title, "Implement feature");
});

test("activity updates badges and aggregate attention without moving spaces or tabs", () => {
  const ss = [space([tab("first"), tab("second")]), space([tab("third")], "s2")];
  const ps = [pane("p1", "first"), pane("p2", "second"), pane("p3", "third")];
  const before = workspaceTree(ss, ps, [], ps.map(p => agent(p, "idle")));
  const after = workspaceTree(ss, ps, [], [agent(ps[0], "working"), agent(ps[1], "blocked"), agent(ps[2], "done")]);
  assert.deepEqual(after.map(s => [s.id, ...s.tabs.map(t => t.id)]), before.map(s => [s.id, ...s.tabs.map(t => t.id)]));
  assert.deepEqual(after.map(s => s.status), ["blocked", "done"]);
  assert.deepEqual(after.map(s => s.agentCount), [2, 1]);
});

test("null non-agent states and unavailable agent states remain distinct", () => {
  assert.equal(urgent([null, undefined]), null);
  assert.equal(urgent([null, "unknown"]), "unknown");
  assert.equal(urgent(["unknown", "idle"]), "idle");
  assert.equal(urgent(["working", "done", "blocked"]), "blocked");
});

test("legacy source activity and native precedence survive the combined hierarchy", () => {
  const p = pane("p", "t", "term");
  const ss = [space([tab("t")])];
  const terminal = { address: "term", state: "live", labels: {
    "herdr.legacy.agent": "codex", "herdr.legacy.pane": "legacy", "herdr.legacy.title": "Task" },
    foreground: { name: "herdr", argv: ["herdr", "--session", "default", "agent", "attach", "legacy"] } };
  const snapshots = { default: { checkedAt: 100, agents: [{ pane_id: "legacy", agent: "codex", agent_status: "blocked" }] } };
  const list = visibleAgents([], ss, [p], [terminal], snapshots, 101);
  assert.equal(workspaceTree(ss, [p], [terminal], list)[0].status, "blocked");
  const native = visibleAgents([agent(p, "working")], ss, [p], [terminal], snapshots, 101);
  assert.equal(workspaceTree(ss, [p], [terminal], native)[0].status, "working");
  assert.equal(native.length, 1);
  assert.equal(workspaceTree(ss, [p], [terminal], visibleAgents([], ss, [p], [terminal], snapshots, 9000))[0].status, "unknown");
});

test("hidden workers remain discoverable but visible panes, duplicate addresses and cycles are excluded", () => {
  const all = [{ address: "a", parent: "root", state: "live" },
    { address: "a", parent: "root", state: "live" },
    { address: "b", parent: "a", state: "live" },
    { address: "a", parent: "b", state: "live" },
    { address: "visible", parent: "root", state: "live" },
    { address: "ended", parent: "root", state: "exited" }];
  const nodes = workerTree(all, "root", new Set(["visible"]));
  assert.deepEqual(nodes.map(n => n.id), ["a"]);
  assert.deepEqual(nodes[0].children.map(n => n.id), ["b"]);
  assert.deepEqual(nodes[0].children[0].children, []);
});

test("background shell jobs do not inflate agent count or imply idle; child agents contribute attention", () => {
  const p = pane("p", "t", "root");
  const all = [{ address: "job", parent: "root", state: "live", status: "idle", program: { name: "node" } },
    { address: "child", parent: "job", state: "live", status: "error", program }];
  const [s] = workspaceTree([space([tab("t")])], [p], all, [agent(p, "idle")]);
  assert.equal(s.agentCount, 2);
  assert.equal(s.status, "blocked");
  assert.equal(s.tabs[0].single.children[0].status, null);
  assert.deepEqual(agentOrder([s]), ["root", "child"]);
});

test("remote activation uses complete IDs and split selection never chooses a guessed pane", () => {
  assert.deepEqual(activation("remote/s", "remote/t"), [
    ["space.select", { id: "remote/s" }], ["tab.select", { id: "remote/t" }]]);
  assert.deepEqual(activation("remote/s", "remote/t", "remote/p"), [["pane.focus", { pane: "remote/p" }]]);
});
