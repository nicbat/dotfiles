import test from "node:test";
import assert from "node:assert/strict";
import { readAttention } from "./read-attention.js";
import { workspaceTree } from "./workspace-tree.js";
import { visibleAgents } from "./visible-agents.js";

function fixture(statuses = ["done", "done"], keys = ["completion-1", "completion-2"]) {
  const leaves = statuses.map((status, i) => ({ id: `p${i}`, pane: `p${i}`, terminal: `t${i}`,
    agent: true, status, completion_key: keys[i], children: [] }));
  return [{ id: "s", status: "done", tabs: [{ id: "tab", status: "done", leaves,
    single: leaves.length === 1 ? leaves[0] : null }] }];
}
const leafStates = tree => tree[0].tabs[0].leaves.map(p => p.status);

test("viewing one split pane acknowledges only that completion and leaves other dots unread", () => {
  const raw = fixture();
  const result = readAttention(raw, {}, { terminal: "t0", pane: "p0" }, true);
  assert.deepEqual(leafStates(result.tree), ["idle", "done"]);
  assert.equal(result.tree[0].status, "done");
  assert.equal(result.tree[0].tabs[0].leaves[0].reportedStatus, "done");
  assert.deepEqual(leafStates(raw), ["done", "done"]);
  assert.deepEqual(result.seen, { t0: "completion-1" });
});

test("read state survives reload and repeated snapshots; container summaries cannot resurrect its dot", () => {
  const first = readAttention(fixture(["done"]), {}, { terminal: "t0" }, true);
  const stored = JSON.parse(JSON.stringify(first.seen));
  const reloaded = readAttention(fixture(["done"]), stored, { terminal: "other" }, true);
  assert.equal(reloaded.changed, false);
  assert.equal(reloaded.tree[0].tabs[0].status, "idle");
  assert.equal(reloaded.tree[0].status, "idle");
  assert.equal(reloaded.tree[0].tabs[0].single.status, "idle");
});

test("a new completion is unread even if the working interval fell between polls", () => {
  const result = readAttention(fixture(["done"], ["new-turn"]), { t0: "old-turn" }, null, true);
  assert.equal(result.tree[0].status, "done");
  assert.equal(result.tree[0].tabs[0].single.reportedStatus, "done");
});

test("space expansion, tab activity, another pane and an inactive window do not acknowledge", () => {
  const tree = fixture();
  tree[0].active = true;
  tree[0].tabs[0].active = true;
  tree[0].tabs[0].leaves[0].focused = true;
  for (const [focus, active] of [[{ pane: "p0" }, true], [{ terminal: "other" }, true], [{ terminal: "t0" }, false]]) {
    const result = readAttention(tree, {}, focus, active);
    assert.deepEqual(result.seen, {});
    assert.deepEqual(leafStates(result.tree), ["done", "done"]);
  }
});

test("missing status keeps read state; working and blocked remain real attention states", () => {
  const unknown = readAttention(fixture(["unknown"]), { t0: "completion-1" }, { terminal: "t0" }, true);
  assert.equal(unknown.tree[0].status, "unknown");
  assert.deepEqual(unknown.seen, { t0: "completion-1" });
  const returned = readAttention(fixture(["done"]), unknown.seen, null, true);
  assert.equal(returned.tree[0].status, "idle");
  const blocked = readAttention(fixture(["blocked"]), returned.seen, { terminal: "t0" }, true);
  assert.equal(blocked.tree[0].status, "blocked");
  const working = readAttention(fixture(["working"]), blocked.seen, { terminal: "other" }, true);
  assert.equal(working.tree[0].status, "working");
  assert.deepEqual(working.seen, {});
});

test("native sequence changes and unversioned observed working cycles re-arm the dot", () => {
  const original = fixture(["done"], [undefined]);
  original[0].tabs[0].leaves[0].seq = 10;
  const read = readAttention(original, {}, { terminal: "t0" }, true);
  const later = fixture(["done"], [undefined]);
  later[0].tabs[0].leaves[0].seq = 11;
  assert.equal(readAttention(later, read.seen).tree[0].status, "done");
  const unversioned = readAttention(fixture(["done"], [undefined]), {}, { terminal: "t0" }, true);
  const work = readAttention(fixture(["working"], [undefined]), unversioned.seen);
  assert.equal(readAttention(fixture(["done"], [undefined]), work.seen).tree[0].status, "done");
});

test("viewing a worker peek acknowledges the child without acknowledging its parent", () => {
  const tree = fixture(["done"]);
  tree[0].tabs[0].single.children = [{ id: "child", terminal: "child", agent: true,
    status: "done", children: [] }];
  const result = readAttention(tree, {}, { terminal: "child", pane: "p0" }, true);
  assert.equal(result.tree[0].tabs[0].single.status, "done");
  assert.equal(result.tree[0].tabs[0].single.children[0].status, "idle");
  assert.ok(!result.seen.t0);
});

test("legacy completion sequence changes re-arm attention; polling revisions do not", () => {
  const spaces = [{ id: "s", name: "s", tabs: [{ id: "tab", name: "Task" }] }];
  const panes = [{ pane: "p", terminal: "t", tab: "tab", program: {} }];
  const terminal = { address: "t", state: "live", labels: {
    "herdr.legacy.agent": "claude", "herdr.legacy.pane": "source" },
    foreground: { name: "herdr", argv: ["herdr", "agent", "attach", "source"] } };
  const source = { pane_id: "source", terminal_id: "source-terminal", agent: "claude", agent_status: "done", completion_seq: 10, revision: 100 };
  const model = () => workspaceTree(spaces, panes, [terminal], visibleAgents([], spaces, panes, [terminal],
    { default: { checkedAt: 1, agents: [source] } }, 2));
  const read = readAttention(model(), {}, { terminal: "t" }, true);
  source.revision++;
  assert.equal(readAttention(model(), read.seen).tree[0].status, "idle");
  source.completion_seq++;
  assert.equal(readAttention(model(), read.seen).tree[0].status, "done");
});

test("hook turn identity survives duplicate Stop timestamps and a new turn re-arms attention", () => {
  const spaces = [{ id: "s", name: "s", tabs: [{ id: "tab", name: "Task" }] }];
  const panes = [{ pane: "p", terminal: "t", tab: "tab", program: {} }];
  const terminal = { address: "t", state: "live", labels: {
    "herdr.codex.session": "session", "herdr.codex.pid": "123" },
    foreground: { name: "declawd", argv: ["declawd", "--codex"], pid: 123 } };
  const record = { session_id: "session", state: "done", turn_id: "turn-1", observed_ms: 1 };
  const model = () => workspaceTree(spaces, panes, [terminal], visibleAgents([], spaces, panes, [terminal], {}, 2, { session: record }));
  const read = readAttention(model(), {}, { terminal: "t" }, true);
  record.observed_ms++;
  assert.equal(readAttention(model(), read.seen).tree[0].status, "idle");
  record.turn_id = "turn-2";
  assert.equal(readAttention(model(), read.seen).tree[0].status, "done");
});
