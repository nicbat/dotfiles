import test from "node:test";
import assert from "node:assert/strict";
import { draftIdentity, draftTargets, applyDrafts, backgroundLabel } from "./draft-status.js";
import { workspaceTree } from "./workspace-tree.js";
import { readAttention } from "./read-attention.js";

const terminal = { address: "t", state: "live", pid: 10, created_ms: 1, foreground: { pid: 11 }, rows: 40, cols: 100 };
const agent = { address: "t", status: "working", program: { key: "claude", agent: true } };
const observation = { identity: draftIdentity(terminal), draft: true, checkedAt: 1000 };

test("draft hint coexists with actual working or completed status and never changes completion identity", () => {
  for (const status of ["working", "done", "idle", "blocked", "unknown"]) {
    const [a] = applyDrafts([{ ...agent, status, completion_key: "turn-7" }], [terminal], { t: observation }, 1001);
    assert.equal(a.draft, true);
    assert.equal(a.status, status);
    assert.equal(a.completion_key, "turn-7");
  }
});

test("background counts are independent of drafts/status and expire with the observed process", () => {
  const o = { ...observation, draft: false, shells: 2 };
  const [a] = applyDrafts([agent], [terminal], { t: o }, 1001);
  assert.equal(a.shells, 2);
  assert.equal(a.draft, false);
  assert.equal(a.status, "working");
  for (const shells of [null, undefined, -1, 1.5, 10001, "2"]) {
    assert.equal(applyDrafts([agent], [terminal], { t: { ...o, shells } }, 1001)[0].shells, null);
  }
  assert.equal(applyDrafts([agent], [terminal], { t: o }, 9001)[0].shells, null);
  assert.equal(applyDrafts([agent], [{ ...terminal, foreground: { pid: 42 } }], { t: o }, 1001)[0].shells, null);
  assert.equal(applyDrafts([agent], [terminal], {}, 1001)[0].shells, null);
  assert.equal(applyDrafts([{ ...agent, program: { key: "pi" } }], [terminal], { t: o }, 1001)[0].shells, null);
  assert.equal(applyDrafts([agent], [terminal], { t: { ...o, shells: 0 } }, 1001)[0].shells, 0);
});

test("split and folded workspace totals mark unobserved supported counts without counting shells as agents", () => {
  const tree = workspaceTree([{ id: "s", tabs: [{ id: "tab" }] }],
    [{ pane: "p1", terminal: "t1", tab: "tab" }, { pane: "p2", terminal: "t2", tab: "tab" }], [],
    [{ ...agent, address: "t1", shells: 2, shellSupported: true },
      { ...agent, address: "t2", shells: null, shellSupported: true }]);
  assert.equal(tree[0].shells, 2);
  assert.equal(tree[0].shellUnknown, 1);
  assert.equal(tree[0].agentCount, 2);
  assert.equal(backgroundLabel(tree[0].shells, tree[0].shellUnknown), "2+ background shells");
  assert.equal(backgroundLabel(1), "1 background shell");
  assert.equal(backgroundLabel(0, 2), "");
});

test("submission, observation failure, expiry and changed processes remove a stale draft", () => {
  for (const [all, observations, now] of [
    [[terminal], { t: { ...observation, draft: false } }, 1001],
    [[terminal], { t: { ...observation, draft: null } }, 1001],
    [[terminal], { t: observation }, 9001],
    [[{ ...terminal, foreground: { pid: 12 } }], { t: observation }, 1001],
    [[{ ...terminal, state: "finished" }], { t: observation }, 1001],
    [[terminal], {}, 1001],
  ]) assert.equal(applyDrafts([agent], all, observations, now)[0].draft, false);
});

test("only recognized live harnesses are observed; prompt contents are absent from the request", () => {
  const targets = draftTargets([agent, { address: "shell", program: { key: "zsh" } }], [terminal, { address: "shell", state: "live" }]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, "claude");
  assert.equal("text" in targets[0], false);
});

test("folded-space and split-tab draft totals preserve counts, native urgency and read acknowledgment", () => {
  const a = { ...agent, status: "done", completion_key: "turn", draft: true };
  const tree = workspaceTree([{ id: "s", tabs: [{ id: "tab", name: "Work" }] }],
    [{ pane: "p", terminal: "t", tab: "tab" }, { pane: "shell", terminal: "shell", tab: "tab" }], [terminal], [a]);
  assert.equal(tree[0].draftCount, 1);
  assert.equal(tree[0].agentCount, 1);
  const viewed = readAttention(tree, {}, { terminal: "t" }, true).tree;
  assert.equal(viewed[0].status, "idle");
  assert.equal(viewed[0].tabs[0].leaves[0].draft, true);
  assert.equal(viewed[0].tabs[0].draftCount, 1);
});
