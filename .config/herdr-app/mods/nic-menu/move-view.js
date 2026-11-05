import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { moveSource, moveTargets } from "./move-targets.js";
import { spaces, panes, terminals, props, theme, exec, home, notify, closeOverlay, setShared } from "herdr";

export function movePicker(view) {
  const t = theme(), p = props();
  const source = moveSource(p, panes(), terminals());
  const targets = moveTargets(source, spaces(), panes(), terminals());
  const selected = targets.find(target => target.tab === view.destination);
  const button = (id, text, action, enabled = true) => div().id(id).px(12).h(32).rounded(6)
    .flex().items_center().text_color(enabled ? t.foreground : t.dim).bg(t.surface)
    .when(enabled, el => el.hover(el => el.bg(t.hover)).on_click((_e, cx) => action(cx))).child(text);
  return v_flex().id("move-to-tab").track_focus(view.handle).size_full().min_h(0).p(16).gap(12)
    .bg(t.popover).text_color(t.foreground).text_size(13)
    .on_key_down((e, cx) => {
      if (view.moving) return;
      if (e.key === "escape") closeOverlay(p.overlay);
      else if (e.key === "up" || e.key === "down") {
        const index = targets.findIndex(target => target.tab === view.destination);
        if (targets.length) view.destination = targets[(index + (e.key === "down" ? 1 : -1) + targets.length) % targets.length].tab;
      } else if (e.key === "enter" && selected) submitMove(view, source, selected, "right", cx);
      else return;
      cx.notify();
    })
    .child(div().font_semibold().text_size(16).child("Move to tab"))
    .child(div().text_color(t.muted).child(view.moving ? "Moving…" : "Choose a tab, then place this terminal beside its selected pane."))
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
      .when(!targets.length, el => el.child(div().text_color(t.muted).child("No other tabs with terminal panes on this computer.")))
      .children(targets.map(target => div().id(`destination-${target.tab}`).px(10).h(32).flex_none().rounded(6)
        .flex().items_center().when(target.tab === view.destination, el => el.bg(t.selected))
        .when(!view.moving, el => el.hover(el => el.bg(t.hover)).on_click((_e, cx) => {
          view.destination = target.tab; cx.notify();
        })).child(div().truncate().tooltip(target.name).child(target.name)))))
    .when(Boolean(view.moveError), el => el.child(div().text_color(t.blocked).child(view.moveError)))
    .child(h_flex().gap(8).justify_end()
      .child(button("move-cancel", "Cancel", () => closeOverlay(p.overlay), !view.moving))
      .child(button("move-down", "Move below", cx => submitMove(view, source, selected, "down", cx), Boolean(source && selected && !view.moving)))
      .child(button("move-right", "Move right", cx => submitMove(view, source, selected, "right", cx), Boolean(source && selected && !view.moving))));
}

function submitMove(view, source, selected, direction, cx) {
  if (!source || !selected || view.moving) return;
  view.moving = true; view.moveError = null; cx.notify();
  cx.spawn(async cx => {
    try {
      const reply = await exec("python3", [`${home()}/.local/bin/herdr-move-terminal.py`, source.terminal, selected.pane, direction]);
      const result = JSON.parse(reply.stdout);
      if (!result.ok) throw new Error(result.error + (result.recovered ? " The terminal was kept in its own tab." : ""));
      setShared("nic.tabs.merged", { tab: result.tab, token: `menu-${Date.now()}` });
      notify({ title: "Terminal moved", body: selected.name, level: "success", timeout: 2500 });
      closeOverlay(props().overlay);
    } catch (error) {
      view.moveError = String(error.message ?? error);
      notify({ title: "Could not finish move", body: view.moveError, level: "error" });
    } finally { view.moving = false; cx.notify(); }
  });
}
