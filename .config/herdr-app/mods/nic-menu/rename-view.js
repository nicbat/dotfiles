// Names one pane's terminal. Herdr renames tabs and spaces but not panes, so the
// name is the terminal's `nic.title` label; the sidebar lists prefer it. It stays
// with the terminal when it moves to another tab. An empty name removes it.
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, theme, hc, notify, closeOverlay } from "herdr";

export const TITLE_LABEL = "nic.title";

export function initRename(view, cx) {
  const value = props()?.name ?? "";
  view.input = InputState.new({ value });
  if (value) view.input.set_selected_range({ start: 0, end: value.length });
  view.input.on("submit", (_e, cx) => submitRename(view, cx));
  view.input.focus();
  cx.timer.after(600, () => view.input.focus());
}

export function renameView(view) {
  const t = theme(), p = props();
  const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
    .hover(s => s.opacity(0.88)).on_click((_e, cx) => action(cx)).child(text);
  return v_flex().id("rename-pane").track_focus(view.handle).w_full().min_h(0).p(18)
    .bg(t.popover).text_color(t.foreground)
    .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Rename pane"))
      .child(div().text_size(11).text_color(t.dim).child("Esc")))
    .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
    .child(Input.new(view.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background)
      .text_size(12.8).text_color(t.foreground))
    .child(div().pt(6).text_size(11.5).text_color(t.dim).child("Leave empty to follow the program's own title again."))
    .child(h_flex().pt(20).gap(8).justify_end()
      .child(button("rn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
      .child(button("rn-save", "Save", true, cx => submitRename(view, cx))));
}

function submitRename(view, cx) {
  if (view.renaming) return;
  const p = props();
  const name = view.input.value().replace(/[\x00-\x1f\x7f]/g, "").trim();
  view.renaming = true;
  cx.spawn(async () => {
    try {
      const reply = await hc(["label", p.terminal, `${TITLE_LABEL}=${name}`]);
      if (reply.code !== 0) throw new Error(reply.stderr.trim() || `hc label exited ${reply.code}`);
      closeOverlay(p.overlay);
    } catch (error) {
      notify({ title: "Could not rename pane", body: String(error.message ?? error), level: "error" });
    } finally { view.renaming = false; }
  });
}
