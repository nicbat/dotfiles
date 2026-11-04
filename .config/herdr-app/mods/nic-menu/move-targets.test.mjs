import test from "node:test";
import assert from "node:assert/strict";
import { moveSource, moveTargets } from "./move-targets.js";

const panes = [{ pane: "source", terminal: "t1", tab: "a" },
  { pane: "other", terminal: "t2", tab: "b" }, { pane: "selected", terminal: "t3", tab: "b", focused: true },
  { pane: "doc", terminal: null, tab: "docs" }, { pane: "remote/p", terminal: "remote/t", tab: "remote/b" }];
const terminals = ["t1", "t2", "t3", "remote/t"].map(address => ({ address, state: "live" }));
const spaces = [{ id: "s", name: "Project", machine: null, tabs: [{ id: "a", name: "Source" }, { id: "b", name: "Destination" }, { id: "docs", name: "Notes" }] },
  { id: "remote/s", name: "Remote", machine: "remote", tabs: [{ id: "remote/b", name: "Remote tab" }] }];

test("right-clicking an unfocused pane always moves that clicked terminal", () => {
  assert.deepEqual(moveSource({ tab: "pane", target: { pane: "source", terminal: "t1" } }, panes, terminals),
    { pane: "source", terminal: "t1", tab: "a" });
  assert.equal(moveSource({ tab: "pane", target: { pane: "source", terminal: "t2" } }, panes, terminals), null);
});

test("a compact single-pane tab offers its terminal; split or document tabs do not guess", () => {
  assert.equal(moveSource({ tab: "tab", target: { id: "a" } }, panes, terminals)?.terminal, "t1");
  assert.equal(moveSource({ tab: "tab", target: { id: "b" } }, panes, terminals), null);
  assert.equal(moveSource({ tab: "tab", target: { id: "docs" } }, panes, terminals), null);
  assert.equal(moveSource({ tab: "tab", target: { id: "a" } }, panes, []), null);
});

test("destinations retain tab order, prefer selected pane and exclude source, remote and document-only tabs", () => {
  const source = moveSource({ tab: "tab", target: { id: "a" } }, panes, terminals);
  assert.deepEqual(moveTargets(source, spaces, panes, terminals),
    [{ pane: "selected", tab: "b", space: "s", name: "Project / Destination" }]);
  assert.deepEqual(moveTargets({ tab: "remote/b" }, spaces, panes, terminals), []);
  assert.deepEqual(moveTargets(source, spaces, panes, terminals.slice(0, 1)), []);
});
