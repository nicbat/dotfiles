import { div } from "gpui-kit";
import { Scrollbar } from "gpui-base";

// Keep GPUI's scroll area and draggable scrollbar. A narrow clipped rail sets
// the painted width; its stable wrapper owns the native opacity transition.
export class SlimScrollbar {
  constructor() {
    this.visible = false;
    this.hovered = false;
    this.serial = 0;
    this.contentHeight = 0;
    this.viewportHeight = 0;
  }

  canScroll() { return this.contentHeight > this.viewportHeight + 1; }

  measure(part, height, cx) {
    const before = this.canScroll();
    this[part] = height;
    if (before !== this.canScroll()) cx.notify();
  }

  activity(cx) {
    this.timer?.cancel?.();
    const serial = ++this.serial;
    if (!this.visible) { this.visible = true; cx.notify(); }
    if (this.hovered) return;
    this.timer = cx.timer.after(300, cx => {
      if (serial !== this.serial || this.hovered) return;
      this.visible = false;
      cx.notify();
    });
  }

  hover(hovered, cx) {
    this.hovered = hovered;
    this.activity(cx);
  }

  wrap(content, id) {
    return div().id(`${id}-viewport`).relative().flex_1().min_h(0)
      .on_size_change((size, cx) => this.measure("viewportHeight", size.height, cx))
      .child(div().id(id).size_full().min_h(0).overflow_y_scroll()
        .on_scroll_wheel((_event, cx) => this.activity(cx))
        .child(content.on_size_change((size, cx) => this.measure("contentHeight", size.height, cx))))
      .when(this.canScroll(), el => el.child(div().id(`${id}-scrollbar`).absolute().right(0).top(0).bottom(0).w(8)
        .overflow_hidden().opacity(this.visible ? 0.75 : 0)
        .transition("opacity", { duration: this.visible ? 80 : 150, easing: "ease-out" })
        .on_hover((hovered, cx) => this.hover(hovered, cx))
        .child(Scrollbar.vertical(id).mode("always").absolute().inset_0())));
  }

  close() { this.serial++; this.timer?.cancel?.(); }
}
