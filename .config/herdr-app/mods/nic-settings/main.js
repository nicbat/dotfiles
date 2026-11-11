// Workspace settings: the options of the nic-* mods, in one dialog, for what
// Herdr's own Settings (cmd-,) can't hold. Opened with cmd-shift-, (or
// `mod.open nic-settings`), from the sidebar footer, or from Todo's menu.
// Each option writes the shared state its mod already reads.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, shared, setShared, home, run, readTextFile, closeOverlay } from "herdr";
import { headings } from "./todo-file.js"; // a copy of nic-todo's: mods can't import across folders

const art = name => `mods/workspace-chrome/${name}.svg`;
const TODO = "nic.todo.source";
const defaultPath = () => `${home()}/Documents/Obsidian Vault/Todo List.md`;
const expand = path => path.trim().replace(/^~(?=\/|$)/, home());
const tilde = path => path.startsWith(home()) ? `~${path.slice(home().length)}` : path;

export default class WorkspaceSettings extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.note = null; // { path, text } as last read; text null when missing
    this.pathInput = InputState.new({ placeholder: "Path to a Markdown note", value: tilde(this.todo().path) });
    this.pathInput.on("change", (_e, cx) => cx.notify());
    this.pathInput.on("submit", (_e, cx) => this.usePath(cx));
    this.pathInput.focus();
    this.read(cx);
  }

  todo() {
    const saved = shared(TODO);
    return { path: saved?.path || defaultPath(), heading: saved?.heading ?? null, filter: saved?.filter ?? null };
  }

  read(cx) {
    const { path } = this.todo();
    cx.spawn(async cx => {
      const text = await readTextFile(path).catch(() => null);
      this.note = { path, text };
      cx.notify();
    });
  }

  // A new note starts on its first heading, unfiltered, as Todo does.
  usePath(cx) {
    const path = expand(this.pathInput.value());
    if (!path || path === this.todo().path) return;
    setShared(TODO, { path, heading: null, filter: null });
    this.pathInput.set_value(tilde(path));
    this.note = null;
    this.read(cx);
    cx.notify();
  }

  chooseHeading(heading, cx) {
    setShared(TODO, { ...this.todo(), heading, filter: null });
    cx.notify();
  }

  close() { closeOverlay(props()?.overlay); }

  label(text, t) {
    return div().pt(14).pb(6).text_size(11.5).font_medium().text_color(t.dim).child(text);
  }

  todoSection(t) {
    const { path, heading } = this.todo();
    const note = this.note?.path === path ? this.note : null;
    const options = note?.text == null ? [] : headings(note.text);
    const current = heading ?? options[0] ?? null;
    const typed = expand(this.pathInput.value());
    const status = !note ? "Reading…"
      : note.text == null ? "Not found. Todo will show an error until you choose a note that exists."
      : `${options.length} ${options.length === 1 ? "heading" : "headings"}`;
    return v_flex()
      .child(div().pt(16).text_size(13).font_semibold().child("Todo"))
      .child(this.label("Note file", t))
      .child(h_flex().gap(8)
        .child(Input.new(this.pathInput).flex_1().h(34).px(10).rounded(7).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12.5))
        .child(div().id("use-path").h(34).px(12).flex().items_center().rounded(7).text_size(12.5).cursor_pointer()
          .when(typed && typed !== path, el => el.bg(t.solid).text_color(t.solid_foreground))
          .when(!typed || typed === path, el => el.bg(t.surface).text_color(t.dim))
          .on_click((_e, cx) => this.usePath(cx)).child("Use")))
      .child(div().pt(6).text_size(11.5).text_color(note?.text == null && note ? t.blocked : t.muted).child(status))
      .when(options.length > 0, el => el.child(this.label("Heading", t))
        .child(h_flex().flex_wrap().gap(4).children(options.map((name, i) => div().id(`heading-${i}`)
          .h(26).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
          .bg(name === current ? t.selected : t.surface).text_color(name === current ? t.foreground : t.muted)
          .hover(el => el.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.chooseHeading(name, cx)).child(`# ${name}`)))));
  }

  render() {
    const t = theme();
    return v_flex().id("nic-settings").track_focus(this.handle).w_full().min_h(0).p(18)
      .bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Workspace settings"))
        .child(div().id("ns-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(div().pt(6).text_size(12.8).text_color(t.muted)
        .child("Options for your sidebar and panels. Changes apply as you make them."))
      .child(this.todoSection(t))
      .child(h_flex().pt(20).items_center()
        .child(div().flex_1())
        .child(h_flex().id("herdr-settings").h(28).px(10).gap(6).items_center().rounded(6).text_size(12)
          .text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => { this.close(); run("app.settings"); })
          .child(svg(art("settings")).size(13)).child("Herdr settings…")));
  }
}
