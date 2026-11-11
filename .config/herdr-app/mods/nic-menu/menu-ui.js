// One look for every menu: right-click menus, ··· actions and pickers.
// Copied into nic-menu, nic-prs and nic-todo (mods can't import each other); keep the copies the same.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

const art = name => `mods/workspace-chrome/${name}.svg`;

// The framed box; `width` px, as tall as its rows.
export function menuPanel(id, t, width = 220) {
  return v_flex().id(id).w(width).flex_none().p(4).rounded(8).bg(t.popover).border_1().border_color(t.border)
    .shadow_md().text_size(12).text_color(t.foreground).role("menu")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
}

// A row: { label, icon?, checked?, hint?, active?, disabled? }. `checked` (true/false) draws a check
// slot instead of an icon, for pickers.
export function menuItem(id, item, action, t) {
  const glyph = item.checked !== undefined ? (item.checked ? "check" : null) : item.icon;
  return h_flex().id(id).h(26).flex_none().w_full().px(7).gap(8).items_center().rounded(5)
    .role("menu_item").accessibility_label(item.label)
    .text_color(item.disabled ? t.dim : t.foreground)
    .when(Boolean(item.active), el => el.bg(t.selected))
    .when(!item.disabled, el => el.cursor_pointer().hover(el => el.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
    .child(div().size(13).flex_none().flex().items_center().justify_center()
      .when(Boolean(glyph), el => el.child(svg(art(glyph)).size(13)
        .text_color(item.checked ? t.accent : t.muted))))
    .child(div().flex_1().min_w(0).truncate().child(item.label))
    .when(Boolean(item.hint), el => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(item.hint)));
}

export function menuRule(t) {
  return div().flex_none().mx(6).my(3).h(1).bg(t.border);
}

export function menuHeading(text, t) {
  return div().flex_none().px(7).pt(3).pb(2).text_size(10.5).text_color(t.dim).truncate().child(text);
}
