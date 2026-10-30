import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { keys, run, props, closeOverlay, theme, nextCommand } from "herdr";

// The reference reads live bindings; editing keys.json updates its shortcut labels.
const GROUPS = [
  { key: "n", title: "Navigation", note: "Alt moves between agents, spaces and panes.", items: [
    ["a", "Previous agent", "agent.prev"], ["s", "Next agent", "agent.next"],
    ["g", "Go to a space, tab or agent…", "mod.open:picker"],
    ["n", "Next space", "space.next"], ["p", "Previous space", "space.prev"],
  ] },
  { key: "t", title: "Tabs & spaces", note: "Ctrl+1–9 selects tabs. Alt+1–9 selects spaces.", items: [
    ["n", "New tab", "tab.new"], ["s", "New space", "space.new"],
    ["]", "Next tab", "tab.next"], ["[", "Previous tab", "tab.prev"],
    ["r", "Rename tab…", "tab.rename"], ["w", "Rename space…", "space.rename"],
    ["x", "Close tab and its terminals", "tab.close"],
  ] },
  { key: "p", title: "Panes", note: "Alt+H/J/K/L focuses panes. Add Shift to swap them.", items: [
    ["r", "Split right", "pane.split:right"], ["d", "Split down", "pane.split:down"],
    ["h", "Focus left", "pane.go:left"], ["j", "Focus down", "pane.go:down"],
    ["k", "Focus up", "pane.go:up"], ["l", "Focus right", "pane.go:right"],
    ["z", "Expand pane / restore split", "pane.zoom"], ["x", "Close focused pane", "pane.close"],
  ] },
  { key: "a", title: "App & appearance", note: "Ctrl+Shift manages the app. Ctrl+, opens settings.", items: [
    ["p", "Command palette…", "app.palette"], ["s", "Settings…", "app.settings"],
    ["b", "Toggle sidebar", "layout.toggle:sidebar"], ["l", "Cycle layouts", "layout.switch"],
    ["+", "Increase text and UI size", "app.zoom_in"], ["-", "Decrease text and UI size", "app.zoom_out"],
    ["0", "Reset text and UI size", "app.zoom_reset"],
  ] },
  { key: "c", title: "Clipboard", note: "These act on the focused terminal.", items: [
    ["c", "Copy selection", "terminal.copy"], ["v", "Paste", "terminal.paste"],
    ["i", "Paste image", "terminal.paste_image"],
  ] },
];

function shortcut(action) {
  const matches = keys().filter(k => k.action === action && !k.keys.startsWith("ctrl-b "));
  // Keep the compact reference readable when an action has several aliases.
  const names = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", up: "↑", down: "↓", left: "←", right: "→" };
  return matches.slice(0, 2).map(k => k.keys.replace(/--$/, "-−").split("-")
    .map(part => names[part] ?? (part.length === 1 || /^f\d+$/.test(part) ? part.toUpperCase() : part))
    .join("+")).join("  /  ");
}

export default class WhichKey extends View {
  init(_props, cx) {
    this.group = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        const group = GROUPS.find(g => g.key === command || g.title.toLowerCase() === command);
        if (group) { this.group = group.key; cx.notify(); }
      }
    });
  }

  execute(action) {
    closeOverlay(props().overlay);
    const at = action.indexOf(":");
    if (at < 0) run(action);
    else {
      const name = action.slice(0, at), value = action.slice(at + 1);
      const arg = name === "pane.split" || name === "pane.go" ? "direction" : name === "mod.open" ? "name" : "id";
      run(name, { [arg]: value });
    }
  }

  key(event, cx) {
    if (event.modifiers.control || event.modifiers.alt || event.modifiers.platform) return;
    const key = event.key_char ?? event.key;
    if (event.key === "escape" || event.key === "backspace") {
      if (this.group) { this.group = null; cx.notify(); }
      else closeOverlay(props().overlay);
    } else if (key === "/" || key === "?") this.execute("app.help");
    else if (!this.group) {
      const group = GROUPS.find(g => g.key === key.toLowerCase());
      if (!group) return;
      this.group = group.key; cx.notify();
    } else {
      const item = GROUPS.find(g => g.key === this.group)?.items.find(i => i[0] === key.toLowerCase());
      if (!item) return;
      this.execute(item[2]);
    }
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const group = GROUPS.find(g => g.key === this.group);
    const keycap = key => div().w(28).h(26).flex_none().flex().items_center().justify_center()
      .rounded(5).bg(t.raised).text_color(t.accent).font_semibold().child(key);
    const row = (id, key, label, binding, action) => h_flex().id(id).h(45).px(10).gap(12)
      .items_center().rounded(7).cursor_pointer().hover(el => el.bg(t.hover)).on_click(action)
      .child(keycap(key)).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(label))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(binding));
    return v_flex().id("which-key").track_focus(this.handle).size_full().min_h(0).p(20).gap(12)
      .bg(t.popover).text_size(13).on_key_down((event, cx) => this.key(event, cx))
      .child(h_flex().items_center().gap(12)
        .child(div().flex_1().text_size(18).font_semibold().text_color(t.foreground).child(group ? `Which-key / ${group.title}` : "Which-key"))
        .child(div().text_color(t.dim).child("F1 · Esc to close")))
      .child(div().text_color(t.muted).child(group?.note ?? "No prefix needed: Alt navigates · Ctrl selects tabs · Ctrl+Shift manages"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(4).children(group
        ? group.items.map(([key, label, action]) => row(`action-${key}`, key, label, shortcut(action), () => this.execute(action)))
        : GROUPS.map(g => row(`group-${g.key}`, g.key.toUpperCase(), g.title, "Open →", (_event, cx) => { this.group = g.key; cx.notify(); }))))
      .child(row("all-keys", "/", "Search every keybinding…", "Ctrl+Shift+?", () => this.execute("app.help")))
      .child(div().text_size(11.5).text_color(t.dim).child(group
        ? "Press a row’s letter or click it to run. Esc / Backspace returns to the groups."
        : "Press a group letter, then an action letter. Shortcuts on the right also work directly."));
  }
}
