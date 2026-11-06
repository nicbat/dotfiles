import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { panelChoices } from "./panel-choices.js";

test("both personal layouts expose PRs without changing Files/Changes preferences or main pane identity", () => {
  for (const name of ["nic-combined", "nic-main"]) {
    const layout = JSON.parse(readFileSync(new URL(`../../layouts/${name}.json`, import.meta.url)));
    assert.deepEqual(panelChoices(layout, ["files"]), ["files", "prs"]);
    assert.deepEqual(panelChoices(layout, []), ["prs"]);
    assert.deepEqual(panelChoices(layout, ["prs", "changes"]), ["prs", "changes"]);
    const main = layout.children[1].children[1].children[0];
    assert.equal(main.id, "main"); assert.equal(main.content.tab, "active");
    const panel = layout.children[1].children[1].children[1];
    assert.equal(panel.children[0].id, "panel-body");
    assert.deepEqual(panel.children[0].children.map(child => child.id), ["files", "changes", "prs"]);
  }
});
test("layouts without a PR view retain their previous choices", () => {
  assert.deepEqual(panelChoices(null, null), ["files", "changes"]);
  assert.deepEqual(panelChoices({ id: "panel", children: [{ id: "files" }] }, ["changes"]), ["changes"]);
});
