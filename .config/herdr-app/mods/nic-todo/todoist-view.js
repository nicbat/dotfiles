// The Todo section's Todoist list: a view (Today, Upcoming, Inbox, a saved filter, a
// project or a label) picked per machine. The ring completes a task (with Undo), the field
// on top adds one with Quick Add, and clicking a task opens an editor that can also open
// it in Todoist's desktop app. The API key is kept in the system keychain (see todoist-client.js);
// pasting it into the section saves it there.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Popover, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, props, shared, setShared, exec, checking, settings, appHome } from "herdr";
import { platform } from "os";
import { writeFile } from "fs/promises";
import { readKey, saveKey, loadCatalog, loadView, openTask, isMac, updateTask, closeTask, reopenTask, quickAdd, addText, BUILT_IN, ADD_KEY_COMMAND, LINUX_ADD_KEY_COMMAND } from "./todoist-client.js";
import { buildView, projectEntries, sameView, withDescendants, plainTitle } from "./todoist-model.js";
import { SlimScrollbar } from "./slim-scrollbar.js";
import { menuPanel, menuItem, menuRule, menuHeading } from "./menu-ui.js";
import { sourceItems } from "./backend.js";

const art = name => `mods/workspace-chrome/${name}.svg`;
// { view: {kind, id?, name, query?}, filter } for this machine, in excluded shared.json.
const STATE = "nic.todo.todoist";
const REFRESH_MS = 60000;
const CATALOG_MS = 10 * 60000;
const COMPLETED_MS = 8000;
const idOf = key => { let h = 5381; for (const c of String(key)) h = (h * 33 + c.codePointAt(0)) >>> 0; return h.toString(36); };

// Host calls, replaceable by tests.
export const deps = {
  request: (url, options) => fetch(url, options),
  exec: (command, args, options) => exec(command, args, options),
  os: () => platform(),
  writeFile: (path, text) => writeFile(path, text),
  // A private folder for handing the key to secret-tool on Linux (data/ is outside dotfiles).
  keyFolder: () => `${appHome()}/data/nic-todo-key`,
  now: () => new Date()
};

const ago = ms => {
  const min = Math.round(ms / 60000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export default class TodoistTodo extends View {
  init(_props, cx) {
    this.scrollbar = new SlimScrollbar();
    this.scrollbar.activity(cx);
    this.key = undefined;
    this.error = null;
    this.keyInput = InputState.new({ placeholder: "Paste your Todoist API key" });
    this.keyInput.set_masked?.(true);
    this.keyInput.on("submit", (_e, cx) => this.saveKey(cx));
    this.addInput = InputState.new({ placeholder: "Add a task: tomorrow, p1, @label…", value: localStorage.getItem("todoist-draft") ?? "" });
    this.addInput.on("change", () => localStorage.setItem("todoist-draft", this.addInput.value()));
    this.addInput.on("submit", (_e, cx) => this.add(cx));
    this.editTitle = InputState.new({ placeholder: "Task name" });
    this.editTitle.on("submit", (_e, cx) => this.saveEdit(cx));
    this.editDue = InputState.new({ placeholder: "Due: tomorrow 5pm, every mon…" });
    this.editDue.on("submit", (_e, cx) => this.saveEdit(cx));
    this.editDesc = TextareaState.new({ placeholder: "Description" });
    this.editDesc.set_auto_grow?.(2, 6);
    // Changes Todoist hasn't confirmed in a fresh load yet: id -> { hide?, patch?, doneSeq }.
    this.overlays = new Map();
    this.seq = 0;
    try {
      const cached = JSON.parse(localStorage.getItem("todoist-cache") ?? "null");
      this.catalog = cached?.catalog ?? null;
      this.data = cached?.data ?? null;
      this.loadedAt = cached?.loadedAt ?? null;
    } catch (_) { this.catalog = this.data = this.loadedAt = null; }
    this.catalogAt = 0;
    this.publish();
    if (checking()) return; // no Keychain or network while Herdr checks the mod
    this.refresh(cx, { catalog: true });
    cx.timer.every(REFRESH_MS, cx => this.refresh(cx, { catalog: Date.now() - this.catalogAt > CATALOG_MS }));
  }

  close() { this.scrollbar?.close(); }

  state() { return shared(STATE) ?? {}; }
  view() { return this.state().view ?? BUILT_IN.today; }
  setState(patch) { setShared(STATE, { ...this.state(), ...patch }); }

  shown() {
    const data = this.data;
    if (!data || !sameView(data.view, this.view())) return null;
    const hidden = new Set();
    const tasks = data.tasks.map(task => {
      const overlay = this.overlays.get(task.id);
      if (overlay?.hide) hidden.add(task.id);
      return overlay?.patch ? { ...task, ...overlay.patch } : task;
    });
    return buildView({ view: data.view, tasks, sections: data.sections, hidden,
      projects: this.catalog?.projects ?? [], now: deps.now() });
  }

  publish() {
    const count = this.shown()?.open ?? 0;
    if (shared("nic.sidebar.todo-count") !== count) setShared("nic.sidebar.todo-count", count);
  }

  // One load at a time; asks made meanwhile run once more afterwards.
  refresh(cx, options = {}) {
    if (this.loading) { this.again = { catalog: this.again?.catalog || options.catalog }; return this.ready; }
    this.loading = true;
    cx.notify();
    return this.ready = new Promise(resolve => cx.spawn(async cx => {
      try {
        let next = options;
        while (next) {
          this.again = null;
          await this.load(next);
          this.publish();
          cx.notify();
          next = this.again;
        }
      } finally { this.loading = false; cx.notify(); resolve(); }
    }));
  }

  async load(options) {
    const view = this.view();
    const startSeq = this.seq;
    try {
      if (!this.key) this.key = await readKey(deps.exec, deps.os());
      if (!this.key) { this.error = { kind: "nokey" }; return; }
      if (options.catalog || !this.catalog) {
        this.catalog = await loadCatalog(deps.request, this.key);
        this.catalogAt = Date.now();
      }
      const data = await loadView(deps.request, this.key, view, this.catalog);
      if (!sameView(view, this.view())) { this.again = {}; return; }
      this.data = { view, tasks: data.tasks, sections: data.sections };
      for (const [id, overlay] of this.overlays) if (overlay.doneSeq != null && overlay.doneSeq <= startSeq) this.overlays.delete(id);
      this.loadedAt = Date.now();
      this.error = null;
      localStorage.setItem("todoist-cache", JSON.stringify({ catalog: this.catalog, data: this.data, loadedAt: this.loadedAt }));
    } catch (error) {
      if (error.kind === "auth") this.key = undefined;
      this.error = { kind: error.kind ?? "other", message: error.message };
    }
  }

  // Check a pasted key against Todoist, then keep it in the keychain.
  saveKey(cx) {
    const key = this.keyInput.value().trim();
    if (!key || this.saving) return;
    this.saving = true;
    this.keyNote = "Checking the key…";
    cx.notify();
    return this.ready = new Promise(resolve => cx.spawn(async cx => {
      try {
        const catalog = await loadCatalog(deps.request, key);
        await saveKey(deps.exec, deps.os(), key, { writeFile: deps.writeFile, folder: deps.keyFolder() });
        this.keyInput.set_value("");
        this.keyNote = null;
        this.key = key;
        this.catalog = catalog;
        this.catalogAt = Date.now();
        this.error = null;
        this.saving = false;
        await this.refresh(cx);
      } catch (error) {
        this.keyNote = error.kind === "auth" ? "Todoist didn't accept that key. Copy it again from Settings → Integrations → Developer."
          : error.message;
        if (error.kind === "nokeystore") this.error = { kind: "nokeystore", message: error.message };
      } finally { this.saving = false; cx.notify(); resolve(); }
    }));
  }

  open(item, cx) {
    cx.spawn(async cx => {
      try { await openTask(deps.exec, deps.os(), item.id); }
      catch (error) { this.error = { kind: "open", message: error.message }; cx.notify(); }
    });
  }

  task(id) { return this.data?.tasks.find(t => t.id === id) ?? null; }

  // Run one change against Todoist in its own task; failures show and reload the list.
  // A failure is kept in `notice` (a reload clears only load errors) until the next change.
  change(label, work, cx) {
    if (!this.key) return;
    this.notice = null;
    return new Promise(resolve => cx.spawn(async cx => {
      try { await work(cx); }
      catch (error) {
        if (error.kind === "auth") { this.key = undefined; this.error = { kind: "auth", message: error.message }; }
        else this.notice = `${label} failed: ${error.message}`;
        await this.refresh(cx);
      } finally { this.publish(); cx.notify(); resolve(); }
    }));
  }

  // The ring: complete now, Undo until the next completion. A repeating task moves to its
  // next date instead, so it reloads rather than hiding.
  complete(item, cx) {
    const ids = item.recurring ? new Set() : withDescendants(this.data?.tasks ?? [], item.id);
    const stamp = {};
    for (const id of ids) this.overlays.set(id, { ...this.overlays.get(id), hide: true, stamp });
    this.showCompleted({ id: item.id, title: item.title, recurring: item.recurring }, cx);
    if (this.editing === item.id) this.editing = null;
    this.publish();
    cx.notify();
    return this.change("Completing", async cx => {
      try { await closeTask(deps.request, this.key, item.id); }
      catch (error) {
        for (const id of ids) if (this.overlays.get(id)?.stamp === stamp) this.overlays.delete(id);
        if (this.completed?.id === item.id) this.completed = null;
        throw error;
      }
      const seq = ++this.seq;
      for (const id of ids) if (this.overlays.get(id)?.stamp === stamp) this.overlays.get(id).doneSeq = seq;
      await this.refresh(cx);
    }, cx);
  }

  // The "Completed" bar (and its Undo) lasts COMPLETED_MS, or until its × is clicked.
  showCompleted(done, cx) {
    this.completedTimer?.cancel();
    this.completed = done;
    this.completedTimer = done && cx.timer.after(COMPLETED_MS, cx => {
      if (this.completed === done) { this.completed = null; cx.notify(); }
    });
  }

  undoComplete(cx) {
    const done = this.completed;
    if (!done) return;
    this.completed = null;
    cx.notify();
    return this.change("Undo", async cx => {
      await reopenTask(deps.request, this.key, done.id);
      for (const id of withDescendants(this.data?.tasks ?? [], done.id)) this.overlays.delete(id);
      this.seq++;
      await this.refresh(cx);
    }, cx);
  }

  // Quick Add, placed by the current view: its project (and chosen section) or label;
  // Today gives an undated task today's date.
  add(cx) {
    const typed = this.addInput.value().trim();
    if (!typed || !this.key) return;
    const view = this.view();
    const project = view.kind === "project" ? view.name : null;
    const section = view.kind === "project" ? this.state().filter ?? null : null;
    this.addInput.set_value("");
    localStorage.setItem("todoist-draft", "");
    this.addNote = "Adding…";
    cx.notify();
    return this.change("Adding", async cx => {
      let task;
      try { task = await quickAdd(deps.request, this.key, addText(typed, view, { project, section })); }
      catch (error) {
        if (!this.addInput.value()) { this.addInput.set_value(typed); localStorage.setItem("todoist-draft", typed); }
        this.addNote = null;
        throw error;
      }
      if (view.kind === "today" && !task?.due) task = await updateTask(deps.request, this.key, task.id, { due_string: "today" }) ?? task;
      this.seq++;
      await this.refresh(cx);
      const visible = this.shown()?.groups.some(g => g.items.some(i => i.id === task?.id));
      const where = this.catalog?.projects.find(p => p.id === task?.project_id)?.name;
      this.addNote = visible ? null : `Added${where ? ` to ${where}` : ""}; it isn't in this view.`;
    }, cx);
  }

  openEditor(item, cx) {
    this.editing = item.id;
    this.editError = null;
    this.editPriority = item.priority;
    this.editTitle.set_value(item.content);
    this.editDesc.set_value(item.description);
    this.editDue.set_value(item.dueString);
    this.editTitle.focus();
    cx.notify();
  }

  closeEditor(cx) { this.editing = null; this.editError = null; cx.notify(); }

  // Save only what changed. An emptied date clears it; an untouched one keeps its repeat.
  saveEdit(cx) {
    const id = this.editing;
    const task = id && this.task(id);
    if (!task) return this.closeEditor(cx);
    const content = this.editTitle.value().trim();
    if (!content) { this.editError = "A task needs a name."; cx.notify(); return; }
    const patch = {};
    if (content !== task.content) patch.content = content;
    const description = this.editDesc.value();
    if (description !== (task.description ?? "")) patch.description = description;
    if (this.editPriority !== (task.priority ?? 1)) patch.priority = this.editPriority;
    const due = this.editDue.value().trim();
    if (due !== (task.due?.string ?? "")) patch.due_string = due || "no date";
    this.editing = null;
    if (!Object.keys(patch).length) { cx.notify(); return; }
    const local = { ...patch };
    if ("due_string" in local) { delete local.due_string; if (!due) local.due = null; }
    const stamp = {};
    this.overlays.set(id, { patch: local, stamp });
    cx.notify();
    return this.change(`Saving “${plainTitle(content)}”`, async cx => {
      let saved;
      try { saved = await updateTask(deps.request, this.key, id, patch); }
      catch (error) { if (this.overlays.get(id)?.stamp === stamp) this.overlays.delete(id); throw error; }
      if (saved && this.data) this.data.tasks = this.data.tasks.map(t => t.id === id ? { ...t, ...saved } : t);
      const overlay = this.overlays.get(id);
      if (overlay?.stamp === stamp) overlay.doneSeq = ++this.seq;
      cx.notify();
    }, cx);
  }

  choose(view, cx) {
    this.setState({ view, filter: null });
    this.choosing = false;
    this.editing = null;
    this.addNote = null;
    this.completed = null;
    this.publish();
    this.refresh(cx);
  }

  button(id, icon, hint, action, t) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(4)
      .role("button").cursor_pointer().text_color(t.muted).tooltip(hint)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx)).child(svg(icon).size(12));
  }

  chip(id, label, on, action, t) {
    return div().id(id).h(20).px(7).flex_none().flex().items_center().rounded(4).text_size(11)
      .role("button").cursor_pointer().bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx)).child(label);
  }

  // Todoist's priority colors, from the theme's ANSI red/yellow/blue so both light and dark work.
  color(priority, t) { return priority === 4 ? t.ansi1 : priority === 3 ? t.ansi3 : priority === 2 ? t.ansi4 : t.muted; }

  // The ring completes the task; it shows a check on hover.
  ring(item, t) {
    const color = item.priority > 1 ? this.color(item.priority, t) : t.input;
    return div().id(`ring-${idOf(item.id)}`).size(15).flex_none().flex().items_center().justify_center()
      .rounded_full().border_1().border_color(color).bg(t.surface).text_color(t.chrome).cursor_pointer()
      .tooltip(item.recurring ? "Complete (moves to the next date)" : "Complete")
      .hover(el => el.bg(color).text_color(t.surface))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.complete(item, cx); })
      .child(svg(art("check")).size(10));
  }

  row(item, t) {
    const id = idOf(item.id);
    const meta = [
      ...(item.project ? [`# ${item.project}`] : []),
      ...item.labels.map(label => `@${label}`)
    ].join("  ");
    const editing = this.editing === item.id;
    const row = h_flex().id(`todoist-${id}`).min_h(30).flex_none().gap(7).pl(3 + item.depth * 16).pr(3).py(3)
      .items_start().rounded(5).cursor_pointer().hover(el => el.bg(t.hover)).when(editing, el => el.bg(t.selected))
      .tooltip("Edit")
      .child(h_flex().h(18).flex_none().items_center().child(this.ring(item, t)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().id(`title-${id}`).min_w(0).truncate().text_size(12).text_color(t.foreground).child(item.title))
        .when(Boolean(item.due || meta), el => el.child(h_flex().min_w(0).gap(6).text_size(10.5)
          .when(Boolean(item.due), el => el.child(div().flex_none()
            .text_color(item.due.overdue ? t.ansi1 : t.muted).child(item.due.text)))
          .when(Boolean(meta), el => el.child(div().min_w(0).truncate().text_color(t.dim).child(meta))))));
    return Popover.new(`edit-${id}`).anchor("top_left")
      .open(editing)
      .on_open_change((open, cx) => open ? this.openEditor(item, cx) : (this.editing === item.id && this.closeEditor(cx)))
      .trigger(row)
      .when(editing, el => el.content(this.editor(item, t)));
  }

  action(id, label, action, t, solid = false) {
    return div().id(id).h(24).px(9).flex_none().flex().items_center().rounded(5).text_size(11.5)
      .role("button").cursor_pointer()
      .when(solid, el => el.bg(t.solid).text_color(t.solid_foreground).hover(el => el.opacity(0.9)))
      .when(!solid, el => el.text_color(t.muted).hover(el => el.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);
  }

  // The editor popup: title, description, due date (Todoist's words), priority; Open in Todoist.
  editor(item, t) {
    const field = el => el.w_full().rounded(5).border_1().border_color(t.input).bg(t.surface)
      .text_color(t.foreground).text_size(12);
    return v_flex().id("todoist-editor").w(290).flex_none().p(10).gap(8).rounded(8).bg(t.popover)
      .border_1().border_color(t.border).shadow_md().text_size(12).text_color(t.foreground)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((event, cx) => {
        if (event.key !== "escape") return;
        cx.stop_propagation(); this.closeEditor(cx);
      })
      .child(field(Input.new(this.editTitle)).h(30).px(8))
      .child(field(Textarea.new(this.editDesc)).px(8).py(5).text_size(11.5))
      .child(h_flex().gap(6).items_center()
        .child(div().w(52).flex_none().text_size(11).text_color(t.muted).child("Due"))
        .child(field(Input.new(this.editDue)).flex_1().min_w(0).h(28).px(8)))
      .child(h_flex().gap(6).items_center()
        .child(div().w(52).flex_none().text_size(11).text_color(t.muted).child("Priority"))
        .children([4, 3, 2, 1].map(priority => {
          const on = this.editPriority === priority;
          return h_flex().id(`priority-${priority}`).h(22).px(7).gap(4).flex_none().items_center().rounded(4)
            .role("button").cursor_pointer().text_size(11)
            .bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
            .border_1().border_color(on ? this.color(priority, t) : t.popover)
            .hover(el => el.bg(t.hover))
            .on_click((_e, cx) => { this.editPriority = priority; cx.notify(); })
            .child(div().size(7).rounded_full().bg(this.color(priority, t)))
            .child(`P${5 - priority}`);
        })))
      .when(Boolean(this.editError), el => el.child(div().text_size(11).text_color(t.ansi1).child(this.editError)))
      .child(h_flex().pt(2).gap(4).items_center()
        .child(this.action("todoist-open", "Open in Todoist", cx => { this.closeEditor(cx); this.open(item, cx); }, t))
        .child(div().flex_1())
        .child(this.action("todoist-cancel", "Cancel", cx => this.closeEditor(cx), t))
        .child(this.action("todoist-save", "Save", cx => this.saveEdit(cx), t, true)));
  }

  picker(t) {
    const current = this.view();
    const entry = (id, label, view) => menuItem(id, { label, checked: sameView(view, current) }, cx => this.choose(view, cx), t);
    const catalog = this.catalog;
    const projects = catalog ? projectEntries(catalog.projects) : [];
    return menuPanel("todoist-picker", t, 240).max_h(440).overflow_y_scroll()
      .children(sourceItems(t, cx => { this.choosing = false; cx.notify(); }))
      .child(menuHeading("Views", t))
      .children(Object.values(BUILT_IN).map(view => entry(`view-${view.kind}`, view.name, view)))
      .when(!catalog, el => el.child(menuHeading(this.error?.kind === "nokey" ? "Add your API key to see projects" : "Loading projects…", t)))
      .when(Boolean(catalog?.filters.length), el => el.child(menuRule(t)).child(menuHeading("Filters", t))
        .children(catalog.filters.map(f => entry(`filter-${idOf(f.id)}`, f.name, { kind: "filter", id: f.id, name: f.name, query: f.query }))))
      .when(projects.length > 0, el => el.child(menuRule(t)).child(menuHeading("Projects", t))
        .children(projects.map(p => entry(`project-${idOf(p.id)}`, `${"   ".repeat(p.depth)}${p.name}`,
          { kind: "project", id: p.id, name: p.name }))))
      .when(Boolean(catalog?.labels.length), el => el.child(menuRule(t)).child(menuHeading("Labels", t))
        .children(catalog.labels.map(l => entry(`label-${idOf(l.id)}`, `@${l.name}`, { kind: "label", id: l.id, name: l.name }))));
  }

  message(t) {
    const error = this.error;
    if (!error) return null;
    const mac = isMac(deps.os());
    if (error.kind === "nokey" || error.kind === "auth") return v_flex().id("todoist-nokey").pl(3).pr(12).gap(5)
      .text_size(11).text_color(t.muted).whitespace_normal()
      .child(error.kind === "auth" ? `${error.message}` :
        "Connect Todoist: paste your API key (Todoist → Settings → Integrations → Developer).")
      .child(h_flex().h(30).gap(4).items_center()
        .child(Input.new(this.keyInput).flex_1().min_w(0).h_full().px(8).rounded(5).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12))
        .child(this.button("todoist-save-key", art("check"), "Save in the " + (mac ? "Keychain" : "keyring") + " (Enter)",
          cx => this.saveKey(cx), t)))
      .child(div().id("todoist-key-note").text_color(this.keyNote ? t.foreground : t.dim)
        .child(this.keyNote ?? `Herdr keeps it in your ${mac ? "macOS Keychain" : "system keyring"}, not in dotfiles.`))
      .child(h_flex().gap(4)
        .child(this.chip("todoist-check-key", "Check again", false, cx => this.refresh(cx, { catalog: true }), t)));
    if (error.kind === "nokeystore") return v_flex().id("todoist-nokeystore").pl(3).pr(12).gap(5).text_size(11)
      .text_color(t.foreground).whitespace_normal()
      .child(error.message)
      .child(div().text_color(t.muted).child("Then paste the key here again, or save it yourself:"))
      .child(div().id("todoist-key-command").px(6).py(4).rounded(4).bg(t.surface).text_color(t.foreground)
        .font_family("monospace").text_size(10.5).child(mac ? ADD_KEY_COMMAND : LINUX_ADD_KEY_COMMAND))
      .child(h_flex().child(this.chip("todoist-check-key", "Check again", false, cx => this.refresh(cx, { catalog: true }), t)));
    const stale = this.data && this.loadedAt ? ` Showing the list from ${ago(Date.now() - this.loadedAt)}.` : "";
    return div().id("todoist-error").pl(3).pr(12).text_size(11).text_color(t.foreground).whitespace_normal()
      .child(`${error.message}${stale}`);
  }

  render() {
    const t = theme();
    const narrow = (this.width ?? 268) < 160;
    const view = this.view();
    const shown = this.shown();
    const labels = shown?.groups.filter(g => g.label !== null && g.items.length).map(g => g.label) ?? [];
    const filter = this.state().filter;
    const active = labels.length > 1 && labels.includes(filter) ? filter : null;
    const groups = shown?.groups.filter(g => !active || g.label === active) ?? [];
    const updated = this.loading ? "Refreshing…" : this.loadedAt ? `Updated ${ago(Date.now() - this.loadedAt)} · refresh` : "Refresh";
    return v_flex().id("todo-root").size_full().min_h(0).pl(narrow ? 4 : 9).pr(narrow ? 4 : 0).pb(8).gap(5).bg(t.chrome)
      .on_key_down((event, cx) => {
        if (event.key !== "escape" || !(this.choosing || this.editing)) return;
        this.choosing = false; this.editing = null; cx.stop_propagation(); cx.notify();
      })
      .on_size_change((size, cx) => {
        const wasNarrow = (this.width ?? 268) < 160;
        this.width = size.width;
        const key = `nic.sidebar.height.${props()?.section ?? "todo-section"}`;
        const height = size.height / (Number(settings().zoom) || 1) + 30; // layout px are unzoomed
        if (shared(key) !== height) setShared(key, height);
        if (wasNarrow !== (size.width < 160)) cx.notify();
      })
      .when(!narrow, el => el.child(h_flex().flex_none().pr(12).gap(4).items_center()
        .child(Popover.new("todo-source-picker").anchor("top_left")
          .open(Boolean(this.choosing))
          .on_open_change((open, cx) => { this.choosing = open; cx.notify(); })
          .trigger(h_flex().id("todo-source").h(22).flex_none().min_w(0).gap(4).pl(5).pr(6).items_center()
            .rounded(4).cursor_pointer().text_size(11).text_color(t.muted).tooltip("Choose a Todoist view")
            .hover(el => el.text_color(t.foreground))
            .child(div().min_w(0).truncate().child(`Todoist · ${view.name}`))
            .child(svg(art("chevron-down")).size(9).flex_none()))
          .when(Boolean(this.choosing), el => el.content(this.picker(t))))
        .child(div().flex_1())
        .child(this.button("todoist-refresh", this.loading ? art("spinner") : "mods/nic-todo/refresh.svg", updated,
          cx => this.refresh(cx, { catalog: true }), t))))
      .when(Boolean(this.error) && !narrow, el => el.child(this.message(t)))
      .when(Boolean(this.key) && Boolean(shown) && !narrow, el => el.child(h_flex().h(30).flex_none().gap(4).pl(3).pr(12).items_center()
        .child(Input.new(this.addInput).flex_1().min_w(0).h_full().px(8).rounded(5).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12))
        .child(this.button("todoist-add", art("plus"), `Add to ${view.name} (Enter)`, cx => this.add(cx), t))))
      .when(Boolean(this.notice) && !narrow, el => el.child(h_flex().id("todoist-notice").pl(3).pr(12).gap(6).items_start()
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(11).text_color(t.ansi1).child(this.notice))
        .child(div().id("todoist-notice-close").text_size(11).text_color(t.muted).cursor_pointer()
          .on_click((_e, cx) => { this.notice = null; cx.notify(); }).child("×"))))
      .when(Boolean(this.addNote) && !narrow, el => el.child(div().id("todoist-add-note").pl(3).pr(12).text_size(10.5)
        .text_color(t.muted).child(this.addNote)))
      .when(labels.length > 1 && !narrow, el => el.child(h_flex().id("todo-filters").flex_none().flex_wrap().gap(3).pl(3).pr(12)
        .child(this.chip("filter-all", "All", !active, cx => { this.setState({ filter: null }); cx.notify(); }, t))
        .children(labels.map((label, i) => this.chip(`filter-${i}`, label, active === label,
          cx => { this.setState({ filter: label }); cx.notify(); }, t)))))
      .child(this.scrollbar.wrap(v_flex().id("todo-list-content").w_full().flex_none().pr(9)
        .when(!shown && !this.error && !narrow, el => el.child(div().px(3).py(7).text_size(11).text_color(t.muted)
          .child("Loading Todoist…")))
        .when(Boolean(shown) && !shown.open && !narrow, el => el.child(div().px(3).py(7).text_size(11)
          .text_color(t.muted).child("Nothing here. Enjoy the quiet.")))
        .when(!narrow, el => el.children(groups.flatMap(group => [
          ...(group.label !== null && group.items.length ? [div().id(`label-${idOf(group.label)}`).px(3).pt(6).pb(1)
            .text_size(10).font_semibold().text_color(group.label === "Overdue" ? t.ansi1 : t.muted).child(group.label)] : []),
          ...group.items.map(item => this.row(item, t))]))), "todo-list"))
      .when(Boolean(this.completed) && !narrow, el => el.child(h_flex().h(23).flex_none().gap(6).pl(3).pr(12).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted)
          .child(this.completed.recurring ? `Completed; “${this.completed.title}” moves to its next date` : `Completed “${this.completed.title}”`))
        .when(!this.completed.recurring, el => el.child(div().id("undo-complete").text_size(11).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => this.undoComplete(cx)).child("Undo")))
        .child(div().id("completed-close").text_size(11).text_color(t.muted).cursor_pointer().tooltip("Dismiss")
          .hover(el => el.text_color(t.foreground))
          .on_click((_e, cx) => { this.showCompleted(null, cx); cx.notify(); }).child("×"))));
  }
}
