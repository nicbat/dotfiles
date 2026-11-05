import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// These tests exercise idle/hover lifecycle, without a real display or clock.
registerHooks({
  resolve(specifier, context, next) {
    return ["gpui-kit", "gpui-base"].includes(specifier) ?
      { url: `scrollbar-test:${specifier}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith("scrollbar-test:") ? { format: "module", shortCircuit: true,
      source: "export const div = () => {}; export const Scrollbar = {};" } : next(url, context);
  }
});
const { SlimScrollbar } = await import("./slim-scrollbar.js");
function context() {
  const pending = [];
  const cx = { notifications: 0, notify() { this.notifications++; }, timer: {
    after(ms, callback) {
      const task = { ms, cancelled: false, fire: () => callback(cx), cancel() { this.cancelled = true; } };
      pending.push(task);
      return task;
    }
  } };
  return { cx, pending };
}

test("continued scrolling resets idle time and stale callbacks cannot hide the active bar", () => {
  const bar = new SlimScrollbar();
  const { cx, pending } = context();
  bar.activity(cx);
  bar.activity(cx);
  assert.equal(pending[0].cancelled, true);
  pending[0].fire();
  assert.equal(bar.visible, true);
  assert.equal(cx.notifications, 1);
  pending[1].fire();
  assert.equal(bar.visible, false);
  assert.equal(cx.notifications, 2);
  bar.activity(cx);
  assert.equal(bar.visible, true);
});

test("hover keeps the rail available for dragging; leaving starts a fresh idle period", () => {
  const bar = new SlimScrollbar();
  const { cx, pending } = context();
  bar.activity(cx);
  bar.hover(true, cx);
  pending[0].fire();
  bar.activity(cx);
  assert.equal(pending.length, 1);
  assert.equal(bar.visible, true);
  bar.hover(false, cx);
  assert.equal(pending.length, 2);
  pending[1].fire();
  assert.equal(bar.visible, false);
});

test("closing cancels the pending fade and prevents a queued callback from notifying a closed view", () => {
  const bar = new SlimScrollbar();
  const { cx, pending } = context();
  bar.activity(cx);
  bar.close();
  assert.equal(pending[0].cancelled, true);
  pending[0].fire();
  assert.equal(cx.notifications, 1);
});

test("both mod-scoped scrollbar helpers stay identical", () => {
  assert.equal(readFileSync(new URL("./slim-scrollbar.js", import.meta.url), "utf8"),
    readFileSync(new URL("../nic-workspaces/slim-scrollbar.js", import.meta.url), "utf8"));
});

test("empty and fitting content has no rail; additions, deletions and resizing update overflow", () => {
  const bar = new SlimScrollbar();
  const { cx } = context();
  bar.measure("viewportHeight", 200, cx);
  assert.equal(bar.canScroll(), false);
  bar.measure("contentHeight", 200, cx);
  assert.equal(bar.canScroll(), false);
  bar.measure("contentHeight", 200.5, cx); // Ignore fractional layout rounding.
  assert.equal(bar.canScroll(), false);
  bar.measure("contentHeight", 230, cx);
  assert.equal(bar.canScroll(), true);
  bar.measure("viewportHeight", 250, cx);
  assert.equal(bar.canScroll(), false);
  bar.measure("viewportHeight", 150, cx);
  assert.equal(bar.canScroll(), true);
  bar.measure("contentHeight", 100, cx);
  assert.equal(bar.canScroll(), false);
  assert.equal(cx.notifications, 4);
});
