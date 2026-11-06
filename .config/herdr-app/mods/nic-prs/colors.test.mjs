import test from "node:test";
import assert from "node:assert/strict";
import { readableText } from "./colors.js";

test("status ink follows its theme when readable and uses UI ink when terminal colors disappear", () => {
  assert.equal(readableText("#7a45c8", "#ffffff", "#1b1b1e"), "#7a45c8");
  assert.equal(readableText("#c678dd", "#111214", "#e8e8ea"), "#c678dd");
  assert.equal(readableText("#ff55ff", "#ffffff", "#1b1b1e"), "#1b1b1e");
  assert.equal(readableText("#ff0000", "#c0c0c0", "#000000"), "#000000");
  assert.equal(readableText("#ff0000", "#000000", "#ffffff"), "#ff0000");
});

test("transparent ink is compared after compositing, and unknown formats use the theme's foreground", () => {
  assert.equal(readableText("#000000ff", "#ffffff", "#1b1b1e"), "#000000ff");
  assert.equal(readableText("#00000020", "#ffffff", "#1b1b1e"), "#1b1b1e");
  assert.equal(readableText(undefined, "#ffffff", "#1b1b1e"), "#1b1b1e");
  assert.equal(readableText("custom-format", "#ffffff", "#1b1b1e"), "#1b1b1e");
});
