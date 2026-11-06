import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Checkbox } from "gpui-base";
import { theme, props, shared, setShared } from "herdr";
import { loadTodos, saveTodos, titleText, displayTodos } from "./todos.js";
import { SlimScrollbar } from "./slim-scrollbar.js";

const art = name => `mods/workspace-chrome/${name}.svg`;

export default class Todo extends View {
  init(_props, cx) {
    this.scrollbar = new SlimScrollbar();
    this.scrollbar.activity(cx);
    try { this.items = loadTodos(localStorage.getItem("todos")); }
    catch (_) { this.items = []; this.error = "Saved todos could not be read. Your data has been kept."; }
    this.addInput = InputState.new({ placeholder: "Add a todo…", value: localStorage.getItem("draft") ?? "" });
    this.addInput.on("change", () => localStorage.setItem("draft", this.addInput.value()));
    this.addInput.on("submit", (_e, cx) => this.add(cx));
    this.editInput = InputState.new();
    this.editInput.on("submit", (_e, cx) => this.saveEdit(cx));
    this.handle = cx.focus_handle();
    this.publish();
  }

  publish() {
    const count = this.items.filter(item => !item.done).length;
    if (shared("nic.sidebar.todo-count") !== count) setShared("nic.sidebar.todo-count", count);
  }

  close() { this.scrollbar?.close(); }

  persist(cx) {
    localStorage.setItem("todos", saveTodos(this.items));
    this.publish();
    cx.notify();
  }

  add(cx) {
    if (this.error) return;
    const title = titleText(this.addInput.value());
    if (!title) return;
    this.items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title, done: false });
    this.addInput.set_value("");
    localStorage.setItem("draft", "");
    this.persist(cx);
  }

  edit(item, cx) {
    this.editing = item.id;
    this.editInput.set_value(item.title);
    this.editInput.focus();
    cx.notify();
  }

  saveEdit(cx) {
    const title = titleText(this.editInput.value());
    if (!title || !this.editing) return;
    this.items = this.items.map(item => item.id === this.editing ? { ...item, title } : item);
    this.editing = null;
    this.persist(cx);
  }

  remove(item, cx) {
    this.removed = { item, index: this.items.findIndex(todo => todo.id === item.id) };
    this.items = this.items.filter(todo => todo.id !== item.id);
    if (this.editing === item.id) this.editing = null;
    this.persist(cx);
  }

  undo(cx) {
    if (!this.removed) return;
    this.items.splice(this.removed.index, 0, this.removed.item);
    this.removed = null;
    this.persist(cx);
  }

  button(id, name, hint, action, t) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(4)
      .role("button").cursor_pointer().text_color(t.muted).tooltip(hint)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx)).child(svg(art(name)).size(12));
  }

  row(item, t) {
    const editing = this.editing === item.id;
    return h_flex().id(`todo-${item.id}`).min_h(30).flex_none().gap(7).px(3).items_center().rounded(5)
      .hover(el => el.bg(t.hover))
      .child(h_flex().id(`check-${item.id}`).size(17).flex_none().items_center().justify_center()
        .tooltip(item.done ? "Reopen todo" : "Complete todo")
        .child(Checkbox.new(`todo-check-${item.id}`).size(15).flex_none().rounded(3).border_1()
        .border_color(item.done ? t.accent : t.input).bg(item.done ? t.accent : t.surface)
        .text_color(t.accent_foreground).checked(item.done).cursor_pointer()
        .on_change((done, cx) => {
          this.items = this.items.map(todo => todo.id === item.id ? { ...todo, done } : todo);
          this.persist(cx);
        }).when(item.done, el => el.child(svg(art("check")).size(12)))))
      .when(editing, el => el.child(Input.new(this.editInput).flex_1().min_w(0).h(27).px(5)
        .rounded(4).border_1().border_color(t.accent).bg(t.surface).text_size(12).text_color(t.foreground))
        .child(this.button(`save-${item.id}`, "check", "Save edit (Enter); Escape cancels", cx => this.saveEdit(cx), t)))
      .when(!editing, el => el.child(div().id(`title-${item.id}`).flex_1().min_w(0).truncate().text_size(12)
        .text_color(item.done ? t.muted : t.foreground).when(item.done, el => el.line_through())
        .on_click((_e, cx) => this.edit(item, cx)).child(item.title))
        .child(this.button(`delete-${item.id}`, "x", "Delete todo", cx => this.remove(item, cx), t)));
  }

  render() {
    const t = theme();
    const narrow = (this.width ?? 268) < 160;
    return v_flex().id("todo-root").size_full().min_h(0).pl(narrow ? 4 : 9).pr(narrow ? 4 : 0).pb(8).gap(5).bg(t.chrome)
      .track_focus(this.handle).on_key_down((event, cx) => {
        if (event.key === "escape" && this.editing) { this.editing = null; cx.stop_propagation(); cx.notify(); }
      })
      .on_size_change((size, cx) => {
        const wasNarrow = (this.width ?? 268) < 160;
        this.width = size.width;
        const key = `nic.sidebar.height.${props()?.section ?? "todo-section"}`;
        if (shared(key) !== size.height + 30) setShared(key, size.height + 30);
        if (wasNarrow !== (size.width < 160)) cx.notify();
      })
      .when(Boolean(this.error), el => el.child(div().text_size(11).text_color(t.foreground).child(this.error)))
      .when(!this.error && !narrow, el => el.child(h_flex().h(30).flex_none().gap(4).pl(3).pr(12).items_center()
        .child(Input.new(this.addInput).flex_1().min_w(0).h_full().px(8).rounded(5).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12))
        .child(this.button("add-todo", "plus", "Add todo (Enter)", cx => this.add(cx), t))))
      .child(this.scrollbar.wrap(v_flex().id("todo-list-content").w_full().flex_none().pr(9)
        .when(!this.error && !this.items.length && !narrow, el => el.child(div().px(3).py(7).text_size(11)
          .text_color(t.muted).child("A place for the little things.")))
        .when(!narrow, el => el.children(displayTodos(this.items).map(item => this.row(item, t)))), "todo-list"))
      .when(Boolean(this.removed) && !narrow, el => el.child(h_flex().h(23).flex_none().gap(6).items_center()
        .child(div().flex_1().text_size(10).text_color(t.muted).child("Todo deleted"))
        .child(div().id("undo-delete").text_size(11).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => this.undo(cx)).child("Undo"))));
  }
}
