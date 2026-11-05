import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dragSource, dropPlan, moved } from "./drag-model.js";

const spaces = [{ id: "s", machine: null, tabs: ["a", "b", "c", "split", "doc"].map(id => ({ id })) },
  { id: "other", machine: null, tabs: [{ id: "d" }] }, { id: "remote", machine: "host", tabs: [{ id: "r" }] }];
const panes = ["a", "b", "c", "d"].map(id => ({ pane: `p${id}`, terminal: `t${id}`, tab: id }));
panes.push({ pane: "ps1", terminal: "ts1", tab: "split" }, { pane: "ps2", terminal: "ts2", tab: "split", focused: true },
  { pane: "pd", terminal: null, tab: "doc", mod: "notes" }, { pane: "pr", terminal: "host/tr", tab: "r" });
const terminals = panes.filter(p => p.terminal).map((p, i) => ({ address: p.terminal, state: "live", pid: i + 10,
  created_ms: i + 100, foreground: { pid: i + 1000 } }));
const source = (kind, id) => dragSource(kind, id, spaces, panes, terminals);
const event = (x = 50, y = 15, shift = false) => ({ position: { x, y }, local_position: { x, y },
  bounds: { x: 0, y: 0, width: 100, height: 30 }, modifiers: { shift } });
const tab = (id, axis = "horizontal") => ({ kind: "tab", id, axis });
const plan = (from, to, e = event(), sp = spaces, ps = panes, ts = terminals) => dropPlan(from, to, e, sp, ps, ts);

test("before/after positions remove the source first in either direction and recognize no-ops", () => {
  assert.equal(plan(source("tab", "a"), tab("c"), event(5)).index, 2);
  assert.equal(plan(source("tab", "a"), tab("c"), event(95)).index, 3);
  assert.equal(plan(source("tab", "c"), tab("a"), event(5)).index, 1);
  assert.equal(plan(source("tab", "c"), tab("a"), event(95)).index, 2);
  assert.equal(plan(source("tab", "a"), tab("b"), event(5)).kind, "none");
  assert.equal(plan(source("tab", "a"), tab("a"), event(95)).kind, "invalid");
});

test("vertical sidebar edges reorder whole split and document tabs; space boundaries are respected", () => {
  assert.equal(plan(source("tab", "split"), tab("a", "vertical"), event(50, 1)).kind, "reorder");
  assert.equal(plan(source("tab", "doc"), tab("a", "vertical"), event(50, 29)).index, 2);
  assert.equal(plan(source("tab", "a"), tab("d"), event(1)).kind, "invalid");
});

test("center drops create a right split and Shift drops create a lower split, including another space", () => {
  const right = plan(source("tab", "a"), tab("b"));
  assert.equal(right.kind, "merge"); assert.equal(right.direction, "right"); assert.equal(right.pane, "pb");
  assert.equal(right.expected.source_pane, "pa"); assert.equal(right.expected.foreground_pid, 1000);
  assert.equal(plan(source("tab", "a"), tab("d"), event(50, 15, true)).direction, "down");
  assert.equal(plan(source("tab", "a"), tab("split")).pane, "ps2");
});

test("a split source requires a specific pane, which may target a tab or an exact destination pane", () => {
  assert.match(plan(source("tab", "split"), tab("a")).label, /drag a pane/);
  assert.equal(plan(source("pane", "ps1"), tab("b"), event(1)).kind, "merge");
  const exact = plan(source("pane", "pa"), { kind: "pane", id: "ps1", axis: "vertical" });
  assert.equal(exact.kind, "merge"); assert.equal(exact.pane, "ps1");
  assert.equal(plan(source("pane", "ps1"), tab("split")).kind, "invalid");
});

test("closed, replaced, finished, remote and document-only terminals cannot merge", () => {
  const original = source("tab", "a");
  assert.equal(plan(original, tab("b"), event(), spaces, panes.filter(p => p.pane !== "pa")).kind, "invalid");
  const changed = terminals.map(t => t.address === "ta" ? { ...t, foreground: { pid: 9999 } } : t);
  assert.equal(plan(original, tab("b"), event(), spaces, panes, changed).kind, "invalid");
  assert.equal(plan(original, tab("b"), event(), spaces, panes, terminals.map(t => ({ ...t, state: "finished" }))).kind, "invalid");
  assert.equal(plan(original, tab("r")).kind, "invalid");
  assert.equal(plan(source("tab", "doc"), tab("b")).kind, "invalid");
  assert.equal(plan(original, tab("doc")).kind, "invalid");
  assert.equal(plan(original, tab("missing")).kind, "invalid");
});

test("missing geometry, outside drops and click-sized motion are safe", () => {
  assert.equal(plan(source("tab", "a"), tab("b"), {}).kind, "invalid");
  assert.equal(plan(source("tab", "a"), tab("b"), event(-1)).kind, "invalid");
  assert.equal(moved({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(moved({ x: 10, y: 10 }, { x: 16, y: 10 }), true);
});

test("the two mod-scoped drag adapters are identical", () => {
  for (const name of ["drag-model.js", "drag-ui.js"])
    assert.equal(readFileSync(new URL(name, import.meta.url), "utf8"),
      readFileSync(new URL(`../nic-workspaces/${name}`, import.meta.url), "utf8"));
});
