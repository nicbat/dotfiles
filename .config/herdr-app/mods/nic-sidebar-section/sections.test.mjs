import test from "node:test";
import assert from "node:assert/strict";
import { find, toggleSection } from "./sections.js";

const options = { section: "todo-section", body: "todo-list", parent: "sidebar-lists" };
function tree() {
  return { id: "sidebar-lists", children: [
    { id: "workspace-section", size: { weight: 3 }, children: [
      { id: "workspace-section-header" }, { id: "workspace-tree" }] },
    { id: "todo-section", size: { weight: 1 }, children: [
      { id: "todo-section-header" }, { id: "todo-list" }] }
  ] };
}

test("collapsing keeps the header and live mod, giving the workspace the freed space", () => {
  const root = tree();
  const change = toggleSection(root, options, id => id === "todo-section" ? 200 : 600);
  assert.equal(change.expandedHeight, 200);
  assert.deepEqual(change.commands, [
    ["layout.hide", { id: "todo-list" }],
    ["layout.resize", { id: "todo-section", px: 30 }],
    ["layout.resize", { id: "workspace-section", weight: 600 }]
  ]);
  assert.equal(find(root, "todo-list").hidden, undefined); // Commands alone own layout mutation.
});

test("reopening restores prior height rather than half the newly enlarged workspace", () => {
  const root = tree();
  find(root, "todo-list").hidden = true;
  const change = toggleSection(root, options, () => 770, 200);
  assert.deepEqual(change.commands, [
    ["layout.show", { id: "todo-list" }],
    ["layout.resize", { id: "todo-section", weight: 200 }],
    ["layout.resize", { id: "workspace-section", weight: 600 }]
  ]);
});

test("a smaller window clamps restoration and never assigns a negative peer size", () => {
  const root = tree();
  find(root, "todo-list").hidden = true;
  const change = toggleSection(root, options, () => 100, 500);
  assert.deepEqual(change.commands.slice(1), [
    ["layout.resize", { id: "todo-section", weight: 100 }],
    ["layout.resize", { id: "workspace-section", weight: 30 }]
  ]);
});

test("either section can reopen when both were collapsed without reopening its peer", () => {
  const root = tree();
  find(root, "todo-list").hidden = true;
  find(root, "workspace-tree").hidden = true;
  const change = toggleSection(root, options, () => 600, 200);
  assert.deepEqual(change.commands, [
    ["layout.show", { id: "todo-list" }], ["layout.resize", { id: "todo-section", weight: 1 }]
  ]);
});

test("an unrelated layout or malformed saved size cannot target a different panel", () => {
  assert.equal(toggleSection({}, options, () => 600, 200), null);
  assert.equal(find({}, undefined), null);
  const root = tree();
  find(root, "todo-list").hidden = true;
  assert.ok(toggleSection(root, options, () => 600, NaN).commands.every(([, args]) => !args.weight || args.weight > 0));
});
