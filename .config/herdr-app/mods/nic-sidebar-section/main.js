import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, props, theme, run, shared, setShared, nextCommand } from "herdr";
import { find, toggleSection } from "./sections.js";

const art = name => `mods/workspace-chrome/${name}.svg`;
const RAIL = 160;

// Back to the width the sidebar had before it folded (nic-chrome saves it).
function expandSidebar() {
  setShared("sidebar.collapsed", false);
  run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 268 });
}

export default class SidebarSection extends View {
  init(_props, cx) {
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === `toggle-${props()?.section}`) this.toggle(cx);
      }
    });
  }

  apply() {
    const change = toggleSection(layout(), props(), id => shared(`nic.sidebar.height.${id}`),
      Number(localStorage.getItem("expanded-height")));
    if (!change) return false;
    if (change.expandedHeight) localStorage.setItem("expanded-height", String(change.expandedHeight));
    change.commands.forEach(([name, args]) => run(name, args));
    return true;
  }

  toggle(cx) {
    if (!this.apply()) return;
    cx.stop_propagation();
    cx.notify();
  }

  // A railHide section folds its body away on the rail, where it has nothing
  // to show, and reopens it with the sidebar unless it was folded already.
  railChange(width, cx) {
    const narrow = width < RAIL;
    if (this.narrow === narrow) return;
    this.narrow = narrow;
    cx.notify();
    if (!props()?.railHide) return;
    const hidden = find(layout(), props().body)?.hidden === true;
    if (narrow && !hidden) {
      localStorage.setItem("rail-folded", "1");
      this.apply();
    } else if (!narrow) {
      if (hidden && localStorage.getItem("rail-folded") === "1") this.apply();
      localStorage.removeItem("rail-folded");
    }
  }

  // On the rail a section shows its railAction (else its action), or its
  // count, which unfolds the sidebar.
  rail(t, p, count) {
    const [action, args, title, icon] = p.railAction
      ? [p.railAction, p.railArgs, p.railTitle, p.railIcon]
      : p.action ? [p.action, undefined, p.actionTitle ?? "Add", "plus"] : [];
    return h_flex().id("section-header").size_full().justify_center().items_center()
      .on_size_change((size, cx) => this.railChange(size.width, cx))
      .child(div().id("section-rail").h(26).px(6).gap(3).flex().items_center().justify_center().rounded(6)
        .role("button").cursor_pointer().text_size(10).text_color(t.muted)
        .hover(el => el.bg(t.hover).text_color(t.foreground))
        .tooltip(action ? title ?? action : `${p.title ?? "Section"} · ${count} ${p.suffix ?? ""} — expand sidebar`.trim())
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); action ? run(action, args) : expandSidebar(); })
        .child(svg(art(action ? icon ?? "plus" : p.railIcon ?? "circle-check")).size(action && icon !== "plus" ? 15 : 13).flex_none())
        .when(!action && count > 0, el => el.child(div().child(String(count)))));
  }

  render() {
    const t = theme(), p = props() ?? {};
    const collapsed = find(layout(), p.body)?.hidden === true;
    const narrow = (find(layout(), "sidebar")?.size?.px ?? 268) < RAIL;
    const count = p.count ? shared(p.count) ?? 0 : 0;
    if (narrow) return this.rail(t, p, count);
    const activity = p.activity ? shared(p.activity) : null;
    const label = activity ? `${activity.working}/${activity.total} agents` : `${count} ${p.suffix ?? ""}`.trim();
    const detail = activity && `${activity.working} working · ${activity.total} open agent sessions${activity.needs ? ` · ${activity.needs} needs you` : ""}${activity.unknown ? ` · ${activity.unknown} status unavailable` : ""}`;
    return h_flex().id("section-header").size_full().pl(9).pr(12).gap(6).items_center()
      .role("button").cursor_pointer().text_size(11).text_color(t.muted)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .tooltip(`${collapsed ? "Expand" : "Collapse"} ${p.title ?? "section"}`)
      .on_size_change((size, cx) => this.railChange(size.width, cx))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.toggle(cx))
      .child(h_flex().id("section-toggle").flex_1().min_w(0).h_full().gap(6).items_center()
        .child(svg(art(collapsed ? "chevron-right" : "chevron-down")).size(10).flex_none())
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(p.title ?? "Section"))
        .child(h_flex().id("section-count").flex_none().gap(4).items_center().text_size(10).text_color(t.muted)
          .when(Boolean(activity), el => el.tooltip(detail).child(div().size(6).flex_none().rounded(3)
            .bg(activity.needs ? t.blocked : activity.working ? t.working : t.dim)))
          .child(label)))
      .when(Boolean(p.action), el => el.child(div().id("section-add").size(22).flex_none().rounded(5)
        .flex().items_center().justify_center().cursor_pointer().tooltip(p.actionTitle ?? "Add")
        .hover(el => el.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); run(p.action); })
        .child(svg(art("plus")).size(12))));
  }
}
