import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Checkbox } from "gpui-base";
import { theme, props, shared, setShared, home, readTextFile, writeTextFile, watchFolder } from "herdr";
import { titleText, headings, viewOf, addTodo, setDone, editTodo, removeTodo, restoreTodo } from "./todo-file.js";
import { SlimScrollbar } from "./slim-scrollbar.js";

const art = name => `mods/workspace-chrome/${name}.svg`;
// Which note and heading this machine shows; kept in Herdr's shared.json, outside dotfiles.
const SOURCE = "nic.todo.source";
const defaultPath = () => `${home()}/Documents/Obsidian Vault/Todo List.md`;
const expand = path => path.trim().replace(/^~(?=\/|$)/, home());
const folderOf = path => path.slice(0, path.lastIndexOf("/")) || "/";
const fileName = path => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Element ids from item keys, which hold arbitrary note text.
const idOf = key => { let h = 5381; for (const c of key) h = (h * 33 + c.codePointAt(0)) >>> 0; return h.toString(36); };

export default class Todo extends View {
  init(_props, cx) {
    this.scrollbar = new SlimScrollbar();
    this.scrollbar.activity(cx);
    this.text = null;
    this.queue = Promise.resolve();
    this.addInput = InputState.new({ placeholder: "Add a todo…", value: localStorage.getItem("draft") ?? "" });
    this.addInput.on("change", () => localStorage.setItem("draft", this.addInput.value()));
    this.addInput.on("submit", (_e, cx) => this.add(cx));
    this.editInput = InputState.new();
    this.editInput.on("submit", (_e, cx) => this.saveEdit(cx));
    this.pathInput = InputState.new({ placeholder: "Path to a Markdown note" });
    this.pathInput.on("submit", (_e, cx) => this.usePath(cx));
    this.handle = cx.focus_handle();
    this.ready = this.load(cx);
    this.watch(cx);
  }

  close() { this.scrollbar?.close(); this.watching = null; }

  source() {
    const saved = shared(SOURCE);
    return { path: saved?.path || defaultPath(), heading: saved?.heading ?? null, filter: saved?.filter ?? null };
  }

  setSource(patch) { setShared(SOURCE, { ...this.source(), ...patch }); }

  heading() {
    const { heading } = this.source();
    return heading ?? (this.text == null ? null : headings(this.text)[0] ?? "Todo");
  }

  publish() {
    const count = this.text == null ? 0 : viewOf(this.text, this.heading()).open;
    if (shared("nic.sidebar.todo-count") !== count) setShared("nic.sidebar.todo-count", count);
  }

  async load(cx) {
    if (this.writing) { this.stale = true; return; }
    const { path } = this.source();
    try {
      const text = await readTextFile(path);
      if (path !== this.source().path) return;
      if (text == null) {
        this.text = null;
        this.error = `Couldn't find ${path}. Choose the note to use below.`;
        this.choosing = true;
      } else {
        this.text = text;
        if (this.error?.startsWith("Couldn't")) this.error = null;
      }
    } catch (error) { this.error = `Couldn't read the note: ${error.message}`; }
    this.publish();
    cx.notify();
  }

  // Follow edits from Obsidian (and Obsidian Sync) while the Todo section is open.
  watch(cx) {
    const token = this.watching = {};
    const { path } = this.source();
    cx.spawn(async cx => {
      while (this.watching === token) {
        let changed;
        try { changed = await watchFolder(folderOf(path)); }
        catch (_) { await cx.sleep(10000); changed = [path]; }
        if (this.watching !== token) return;
        if (changed.includes(path) || changed.includes(folderOf(path))) await this.load(cx);
      }
    });
  }

  // Apply one edit to the note, one at a time. A note that changed underneath is
  // re-read and the edit tried again against what is now there. Saving outlives the
  // click that asked for it, so it runs in its own task with a context that can await.
  change(edit, cx) {
    if (this.text == null) return;
    const prior = this.queue;
    let done;
    this.queue = new Promise(resolve => { done = resolve; });
    cx.spawn(async cx => {
      try { await prior; await this.write(edit, cx); }
      finally { done(); }
    });
    return this.queue;
  }

  async write(edit, cx) {
    const { path } = this.source();
    this.writing = true;
    let base = this.text;
    try {
      for (let attempt = 0; ; attempt++) {
        const next = edit(base);
        if (next === base) break;
        this.text = next;
        this.publish();
        cx.notify();
        try { await writeTextFile(path, next, base); this.error = null; break; }
        catch (error) {
          const fresh = await readTextFile(path);
          this.text = fresh;
          if (attempt || fresh == null) throw error;
          base = fresh;
        }
      }
    } catch (error) { this.error = error.message; this.editing = null; }
    finally {
      this.writing = false;
      this.publish();
      cx.notify();
      if (this.stale) { this.stale = false; await this.load(cx); }
    }
  }

  add(cx) {
    const title = titleText(this.addInput.value());
    if (!title || this.text == null) return;
    const heading = this.heading();
    this.addInput.set_value("");
    localStorage.setItem("draft", "");
    return this.change(text => addTodo(text, heading, title), cx);
  }

  toggle(item, done, cx) { return this.change(text => setDone(text, item.key, done, today()), cx); }

  edit(item, cx) {
    this.editing = item.key;
    this.editInput.set_value(item.title);
    this.editInput.focus();
    cx.notify();
  }

  saveEdit(cx) {
    const title = titleText(this.editInput.value());
    const key = this.editing;
    if (!title || !key) return;
    this.editing = null;
    return this.change(text => editTodo(text, key, title), cx);
  }

  remove(item, cx) {
    if (this.editing === item.key) this.editing = null;
    return this.change(text => {
      const { text: next, undo } = removeTodo(text, item.key);
      this.removed = undo;
      return next;
    }, cx);
  }

  undo(cx) {
    const undo = this.removed;
    if (!undo) return;
    this.removed = null;
    return this.change(text => restoreTodo(text, undo), cx);
  }

  chooseHeading(heading, cx) {
    this.setSource({ heading, filter: null });
    this.choosing = false;
    this.editing = null;
    this.publish();
    cx.notify();
  }

  usePath(cx) {
    const path = expand(this.pathInput.value());
    if (!path) return;
    this.setSource({ path, heading: null, filter: null });
    this.text = null;
    this.error = null;
    this.editing = this.removed = null;
    this.choosing = false;
    this.watch(cx);
    this.ready = new Promise(resolve => cx.spawn(async cx => { try { await this.load(cx); } finally { resolve(); } }));
    cx.notify();
    return this.ready;
  }

  button(id, name, hint, action, t) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(4)
      .role("button").cursor_pointer().text_color(t.muted).tooltip(hint)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx)).child(svg(art(name)).size(12));
  }

  chip(id, label, on, action, t) {
    return div().id(id).h(20).px(7).flex_none().flex().items_center().rounded(4).text_size(11)
      .role("button").cursor_pointer().bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx)).child(label);
  }

  row(item, t) {
    const id = idOf(item.key);
    const editing = this.editing === item.key;
    return h_flex().id(`todo-${id}`).min_h(30).flex_none().gap(7).px(3).items_center().rounded(5)
      .hover(el => el.bg(t.hover))
      .child(h_flex().id(`check-${id}`).size(17).flex_none().items_center().justify_center()
        .tooltip(item.done ? "Reopen todo" : "Complete and archive")
        .child(Checkbox.new(`todo-check-${id}`).size(15).flex_none().rounded(3).border_1()
        .border_color(item.done ? t.accent : t.input).bg(item.done ? t.accent : t.surface)
        .text_color(t.accent_foreground).checked(item.done).cursor_pointer()
        .on_change((done, cx) => this.toggle(item, done, cx))
        .when(item.done, el => el.child(svg(art("check")).size(12)))))
      .when(editing, el => el.child(Input.new(this.editInput).flex_1().min_w(0).h(27).px(5)
        .rounded(4).border_1().border_color(t.accent).bg(t.surface).text_size(12).text_color(t.foreground))
        .child(this.button(`save-${id}`, "check", "Save edit (Enter); Escape cancels", cx => this.saveEdit(cx), t)))
      .when(!editing, el => el.child(div().id(`title-${id}`).flex_1().min_w(0).truncate().text_size(12)
        .text_color(item.done ? t.muted : t.foreground).when(item.done, el => el.line_through())
        .on_click((_e, cx) => this.edit(item, cx)).child(item.title))
        .child(this.button(`delete-${id}`, "x", "Delete todo", cx => this.remove(item, cx), t)));
  }

  settings(t) {
    const current = this.heading();
    const options = this.text == null ? [] : headings(this.text);
    return v_flex().id("todo-settings").flex_none().gap(3).pl(3).pr(12).pb(4)
      .children(options.map((name, i) => h_flex().id(`heading-${i}`).h(24).px(6).gap(6).items_center().rounded(4)
        .cursor_pointer().text_size(12).text_color(name === current ? t.foreground : t.muted)
        .bg(name === current ? t.selected : t.chrome).hover(el => el.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.chooseHeading(name, cx))
        .child(div().w(10).flex_none().child(name === current ? "✓" : "")).child(`# ${name}`)))
      .child(div().pt(3).text_size(10).text_color(t.muted).child("Note file"))
      .child(h_flex().h(28).gap(4).items_center()
        .child(Input.new(this.pathInput).flex_1().min_w(0).h_full().px(7).rounded(5).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(11))
        .child(this.button("use-path", "check", "Use this note (Enter)", cx => this.usePath(cx), t)));
  }

  render() {
    const t = theme();
    const narrow = (this.width ?? 268) < 160;
    const { path, filter } = this.source();
    const heading = this.heading();
    const view = this.text == null ? null : viewOf(this.text, heading);
    const labels = view?.groups.slice(1).map(group => group.label) ?? [];
    const active = labels.includes(filter) ? filter : null;
    const groups = view?.groups.filter(group => !active || group.label === active) ?? [];
    const open = groups.reduce((sum, group) => sum + group.items.length, 0);
    return v_flex().id("todo-root").size_full().min_h(0).pl(narrow ? 4 : 9).pr(narrow ? 4 : 0).pb(8).gap(5).bg(t.chrome)
      .track_focus(this.handle).on_key_down((event, cx) => {
        if (event.key !== "escape" || !(this.editing || this.choosing)) return;
        this.editing = null; this.choosing = false; cx.stop_propagation(); cx.notify();
      })
      .on_size_change((size, cx) => {
        const wasNarrow = (this.width ?? 268) < 160;
        this.width = size.width;
        const key = `nic.sidebar.height.${props()?.section ?? "todo-section"}`;
        if (shared(key) !== size.height + 30) setShared(key, size.height + 30);
        if (wasNarrow !== (size.width < 160)) cx.notify();
      })
      .when(!narrow, el => el.child(h_flex().id("todo-source").h(22).flex_none().gap(4).pl(5).pr(12).items_center()
        .rounded(4).cursor_pointer().text_size(11).text_color(t.muted).tooltip(path)
        .hover(el => el.text_color(t.foreground))
        .on_click((_e, cx) => {
          this.choosing = !this.choosing;
          if (this.choosing) this.pathInput.set_value(this.source().path.replace(home(), "~"));
          cx.notify();
        })
        .child(div().min_w(0).truncate().child(`${fileName(path)} · ${heading ?? "…"}`))
        .child(svg(art(this.choosing ? "chevron-down" : "chevron-right")).size(9).flex_none())))
      .when(Boolean(this.choosing) && !narrow, el => el.child(this.settings(t)))
      .when(Boolean(this.error), el => el.child(div().pl(3).pr(12).text_size(11).text_color(t.foreground)
        .whitespace_normal().child(this.error)))
      .when(Boolean(view) && !narrow, el => el.child(h_flex().h(30).flex_none().gap(4).pl(3).pr(12).items_center()
        .child(Input.new(this.addInput).flex_1().min_w(0).h_full().px(8).rounded(5).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12))
        .child(this.button("add-todo", "plus", `Add to # ${heading} (Enter)`, cx => this.add(cx), t))))
      .when(labels.length > 0 && !narrow, el => el.child(h_flex().id("todo-filters").flex_none().flex_wrap().gap(3).pl(3).pr(12)
        .child(this.chip("filter-all", "All", !active, cx => { this.setSource({ filter: null }); cx.notify(); }, t))
        .children(labels.map((label, i) => this.chip(`filter-${i}`, label, active === label,
          cx => { this.setSource({ filter: label }); cx.notify(); }, t)))))
      .child(this.scrollbar.wrap(v_flex().id("todo-list-content").w_full().flex_none().pr(9)
        .when(Boolean(view) && !open && !narrow, el => el.child(div().px(3).py(7).text_size(11)
          .text_color(t.muted).child(view.found ? "A place for the little things." : `Adding a todo creates # ${heading}.`)))
        .when(!narrow, el => el.children(groups.flatMap(group => [
          ...(group.label !== null && group.items.length ? [div().id(`label-${idOf(group.label)}`).px(3).pt(6).pb(1)
            .text_size(10).font_semibold().text_color(t.muted).child(group.label)] : []),
          ...group.items.map(item => this.row(item, t))])))
        .when(Boolean(view?.archived.length) && !narrow, el => el
          .child(h_flex().id("archive-toggle").h(24).mt(4).px(3).gap(5).items_center().rounded(4).cursor_pointer()
            .text_size(10).text_color(t.muted).hover(el => el.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.archiveOpen = !this.archiveOpen; cx.notify(); })
            .child(svg(art(this.archiveOpen ? "chevron-down" : "chevron-right")).size(9))
            .child(`Archive · ${view.archived.length}`))
          .when(Boolean(this.archiveOpen), el => el.children(view.archived.map(item => this.row(item, t))))), "todo-list"))
      .when(Boolean(this.removed) && !narrow, el => el.child(h_flex().h(23).flex_none().gap(6).items_center()
        .child(div().flex_1().text_size(10).text_color(t.muted).child("Todo deleted"))
        .child(div().id("undo-delete").text_size(11).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => this.undo(cx)).child("Undo"))));
  }
}
