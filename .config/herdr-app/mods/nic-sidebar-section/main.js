import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, props, theme, run, shared, nextCommand } from "herdr";
import { find, toggleSection } from "./sections.js";

const art = name => `mods/workspace-chrome/${name}.svg`;

export default class SidebarSection extends View {
  init(_props, cx) {
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === `toggle-${props()?.section}`) this.toggle(cx);
      }
    });
  }

  toggle(cx) {
    const options = props();
    const change = toggleSection(layout(), options, id => shared(`nic.sidebar.height.${id}`),
      Number(localStorage.getItem("expanded-height")));
    if (!change) return;
    if (change.expandedHeight) localStorage.setItem("expanded-height", String(change.expandedHeight));
    change.commands.forEach(([name, args]) => run(name, args));
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme(), p = props() ?? {};
    const collapsed = find(layout(), p.body)?.hidden === true;
    const narrow = (find(layout(), "sidebar")?.size?.px ?? 268) < 160;
    const count = p.count ? shared(p.count) ?? 0 : 0;
    const activity = p.activity ? shared(p.activity) : null;
    const label = activity ? `${activity.working}/${activity.total} agents` : `${count} ${p.suffix ?? ""}`.trim();
    const detail = activity && `${activity.working} working · ${activity.total} open agent sessions${activity.needs ? ` · ${activity.needs} needs you` : ""}${activity.unknown ? ` · ${activity.unknown} status unavailable` : ""}`;
    return h_flex().id("section-header").size_full().pl(narrow ? 4 : 9).pr(narrow ? 4 : 12).gap(6).items_center()
      .role("button").cursor_pointer().text_size(11).text_color(t.muted)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .tooltip(`${collapsed ? "Expand" : "Collapse"} ${p.title ?? "section"}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.toggle(cx))
      .child(h_flex().id("section-toggle").flex_1().min_w(0).h_full().gap(6).items_center()
        .child(svg(art(collapsed ? "chevron-right" : "chevron-down")).size(10).flex_none())
        .when(!narrow, el => el.child(div().flex_1().min_w(0).truncate().font_semibold().child(p.title ?? "Section"))
          .child(h_flex().id("section-count").flex_none().gap(4).items_center().text_size(10).text_color(t.muted)
            .when(Boolean(activity), el => el.tooltip(detail).child(div().size(6).flex_none().rounded(3)
              .bg(activity.needs ? t.blocked : activity.working ? t.working : t.dim)))
            .child(label))))
      .when(Boolean(p.action), el => el.child(div().id("section-add").size(22).flex_none().rounded(5)
        .flex().items_center().justify_center().cursor_pointer().tooltip(p.actionTitle ?? "Add")
        .hover(el => el.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); run(p.action); })
        .child(svg(art("plus")).size(12))));
  }
}
