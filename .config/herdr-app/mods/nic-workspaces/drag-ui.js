import { div } from "gpui-kit";
import { spaces, panes, terminals, focused, window, shared, setShared, run, exec, home, notify } from "herdr";
import { DRAG_KEY, BUSY_KEY, DRAG_MS, dragSource, moved, dropPlan } from "./drag-model.js";

// Each personal mod has its own imports; shared state connects their surfaces.
export class TabDrag {
  constructor(cx) {
    this.owner = `drag-${Date.now()}-${Math.random()}`;
    this.handle = cx.focus_handle();
    this.blockedUntil = 0;
    this.serial = 0;
  }

  state() {
    const state = shared(DRAG_KEY);
    return state && Date.now() < state.until && window()?.active !== false ? state : null;
  }

  cancel(restore = true) {
    const state = shared(DRAG_KEY);
    if (!state) return;
    setShared(DRAG_KEY, null);
    if (restore && state.active && state.focus && focused()?.pane === state.focus && window()?.active !== false)
      run("pane.focus", { pane: state.focus });
  }

  begin(kind, id, event, cx) {
    cx.stop_propagation();
    this.cancel(false);
    this.blockedUntil = 0;
    if (shared(BUSY_KEY) || event.click_count > 1) return;
    const source = dragSource(kind, id, spaces(), panes(), terminals());
    if (!source || !event.position) return;
    const token = `${this.owner}-${++this.serial}`;
    setShared(DRAG_KEY, { source, token, owner: this.owner, origin: event.position,
      until: Date.now() + DRAG_MS, active: false, focus: focused()?.pane ?? null, preview: null });
    cx.timer.after(DRAG_MS, () => {
      if (shared(DRAG_KEY)?.token === token) this.cancel();
    });
  }

  over(target, event, cx) {
    const state = this.state();
    if (!state) return;
    cx.stop_propagation();
    if (!state.active && !moved(state.origin, event.position)) return;
    if (!state.active) this.handle.focus();
    const plan = dropPlan(state.source, target, event, spaces(), panes(), terminals());
    const preview = { ...plan, target: target.id, surface: this.owner };
    if (!state.active || JSON.stringify(state.preview) !== JSON.stringify(preview))
      setShared(DRAG_KEY, { ...state, active: true, preview, target, pointer: event });
  }

  release(target, event, cx) {
    const state = this.state();
    cx.stop_propagation();
    if (!state) {
      const blocked = Boolean(shared(DRAG_KEY) || shared(BUSY_KEY) || window()?.active === false);
      this.cancel(false);
      return blocked;
    }
    const active = state.active || moved(state.origin, event.position);
    if (!active) { this.cancel(false); return false; }
    this.blockedUntil = Date.now() + 250;
    const plan = dropPlan(state.source, target, event, spaces(), panes(), terminals());
    this.cancel(plan.kind !== "merge");
    if (plan.kind === "reorder") run("tab.move", { id: plan.tab, index: plan.index });
    if (plan.kind === "merge") {
      setShared(BUSY_KEY, state.token);
      cx.spawn(async cx => {
        try {
          const reply = await exec("python3", [`${home()}/.local/bin/herdr-move-terminal.py`,
            plan.terminal, plan.pane, plan.direction, JSON.stringify(plan.expected)]);
          const result = JSON.parse(reply.stdout);
          if (!result.ok) throw new Error(result.error + (result.recovered ? " The terminal is in its own tab." : ""));
          setShared("nic.tabs.merged", { tab: result.tab ?? plan.destinationTab, token: state.token });
        } catch (error) {
          notify({ title: "Could not finish split", body: String(error.message ?? error), level: "error" });
          if (state.focus && focused()?.pane === state.focus && window()?.active !== false)
            run("pane.focus", { pane: state.focus });
        } finally {
          if (shared(BUSY_KEY) === state.token) setShared(BUSY_KEY, null);
          cx.notify();
        }
      });
    }
    return true;
  }

  blockClick() { return this.state()?.active || Date.now() < this.blockedUntil; }

  row(element, kind, id, axis, t, doubleClick = null, click = null) {
    const target = { kind, id, axis };
    const state = this.state(), preview = state?.active && state.preview?.target === id &&
      state.preview.surface === this.owner ? state.preview : null;
    return element.relative()
      .on_mouse_down("left", (event, cx) => {
        this.begin(kind, id, event, cx);
        if (event.click_count === 2) doubleClick?.();
      })
      .on_mouse_move((event, cx) => this.over(target, event, cx))
      .on_mouse_up("left", (event, cx) => {
        if (!this.release(target, event, cx) && event.click_count <= 1) click?.();
      })
      .on_hover((hovered) => {
        const now = shared(DRAG_KEY);
        if (!hovered && now?.preview?.target === id && now.preview.surface === this.owner)
          setShared(DRAG_KEY, { ...now, preview: null });
      })
      .when(state?.active && state.source.kind === kind && state.source.id === id, el => el.opacity(0.6))
      .when(state?.active, el => el.cursor_grabbing())
      .when(preview?.kind === "reorder", el => el.child(div().absolute().bg(t.accent)
        .when(axis === "horizontal", line => line.top(0).bottom(0).w(3)
          .when(preview.edge === "before", line => line.left(0)).when(preview.edge === "after", line => line.right(0)))
        .when(axis === "vertical", line => line.left(0).right(0).h(3)
          .when(preview.edge === "before", line => line.top(0)).when(preview.edge === "after", line => line.bottom(0)))))
      .when(preview?.kind === "merge", el => el.child(div().absolute()
        .top(0).bottom(0).left(0).right(0).rounded(6).border(2).border_color(t.accent)
        .flex().items_center().justify_end().pr(3)
        .child(div().w(22).h(21).rounded(4).bg(t.popover).flex().items_center().justify_center()
          .tooltip(`${preview.label} · Hold Shift to split below`)
          .child(div().w(15).h(13).relative().rounded(2).border(1).border_color(t.accent)
            .child(div().absolute().bg(t.accent)
              .when(preview.direction === "down", line => line.left(0).right(0).top("50%").h(1))
              .when(preview.direction !== "down", line => line.top(0).bottom(0).left("50%").w(1)))))));
  }

  root(element) {
    return element.track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === "escape" && shared(DRAG_KEY)) { cx.stop_propagation(); this.cancel(); }
      })
      .on_modifiers_changed(event => {
        const state = this.state();
        if (!state?.active || !state.preview || !state.target || !state.pointer) return;
        const pointer = { ...state.pointer, modifiers: event.modifiers };
        const preview = { ...dropPlan(state.source, state.target, pointer, spaces(), panes(), terminals()),
          target: state.target.id, surface: state.preview.surface };
        if (JSON.stringify(state.preview) !== JSON.stringify(preview))
          setShared(DRAG_KEY, { ...state, pointer, preview });
      })
      .on_mouse_down_out(() => this.cancel(false))
      .on_mouse_down("left", () => this.cancel(false))
      .on_mouse_down("right", () => this.cancel(false))
      .on_mouse_up("left", () => this.cancel())
      .on_mouse_move(() => {
        const state = this.state();
        if (state?.preview?.surface === this.owner) setShared(DRAG_KEY, { ...state, preview: null });
      });
  }

  close() { if (shared(DRAG_KEY)?.owner === this.owner) this.cancel(false); }
}
