import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popover } from "gpui-base";
import { theme, shared, setShared, exec, nextCommand } from "herdr";
import { HOST, HOSTS, HOST_STORE, STORE, storeKey, selectedHost, FILTERS, loadState, addFolder, updateFolder, deleteFolder,
  reorderFolder, movePR, visiblePRs, statusText, mergeSnapshot } from "./model.js";
import { discoverHosts, refreshPRs, olderPRs } from "./client.js";
import { readableText } from "./colors.js";

export default class PullRequests extends View {
  init(_props, cx) {
    const saved = shared(HOST_STORE);
    this.host = HOSTS.includes(saved) ? saved : shared(STORE) != null ? HOST : "github.com";
    this.generation = 0;
    this.accounts = [];
    this.handle = cx.focus_handle();
    this.newFolder = InputState.new({ placeholder: "New folder…" });
    this.newFolder.on("submit", (_e, cx) => this.createFolder(cx));
    this.renameInput = InputState.new();
    this.renameInput.on("submit", (_e, cx) => this.renameFolder(cx));
    this.search = InputState.new({ placeholder: "Find a PR…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.readState();
    this.detectHosts(cx);
    cx.timer.every(60000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        if (command === "refresh") this.detectHosts(cx);
        if (command === "older") this.loadOlder(cx);
        if (command === "github") this.selectHost("github.com", cx);
        if (command === "enterprise") this.selectHost(HOST, cx);
        if (["open", "merged", "closed", "all"].includes(command))
          this.change(state => ({ ...state, filter: command[0].toUpperCase() + command.slice(1) }), cx);
        cx.notify();
      }
    });
  }

  detectHosts(cx) {
    if (this.discovering || this.busy) return;
    this.discovering = true;
    const generation = this.generation;
    cx.spawn(async cx => {
      try {
        const accounts = await discoverHosts(exec);
        if (generation !== this.generation) return;
        this.accounts = accounts;
        const host = selectedHost(shared(HOST_STORE), accounts.map(account => account.host), shared(STORE) != null);
        if (!host) { this.error = "Sign in with gh auth login, then refresh to load your PRs."; return; }
        if (host !== this.host) this.resetHost(host);
        setShared(HOST_STORE, host);
        this.error = null;
        this.refresh(cx);
      } catch (error) { if (generation === this.generation) this.error = error.message; }
      finally { this.discovering = false; cx.notify(); }
    });
  }

  resetHost(host) {
    this.host = host;
    this.generation++;
    this.busy = false;
    this.error = null;
    this.moving = this.prMenu = this.managing = this.editing = this.hoveredPR = null;
    this.unfiledCollapsed = false;
    this.search.set_value("");
    this.newFolder.set_value("");
    this.readState();
  }

  selectHost(host, cx) {
    if (this.discovering || !this.accounts.some(account => account.host === host)) return;
    this.choosingHost = false;
    if (host !== this.host) {
      this.resetHost(host);
      setShared(HOST_STORE, host);
      this.refresh(cx);
    }
    cx.notify();
  }

  readState() {
    try { this.state = loadState(shared(storeKey(this.host)), this.host); this.dataError = null; }
    catch (_) { this.state = null; this.dataError = "Saved PR data could not be read. It has been kept intact."; }
  }

  change(action, cx) {
    this.readState();
    if (!this.state) return false;
    try { const next = action(this.state); setShared(storeKey(this.host), loadState(next, this.host)); this.state = next; }
    catch (error) { this.error = error.message; cx.notify(); return false; }
    cx.notify();
    return true;
  }

  refresh(cx) {
    this.readState();
    if (this.busy || !this.state || !this.accounts.some(account => account.host === this.host)) return;
    this.busy = true;
    const snapshot = this.state;
    const generation = this.generation;
    cx.spawn(async cx => {
      try {
        const result = await refreshPRs(exec, snapshot);
        if (generation !== this.generation) return;
        // Re-read before applying network results so intervening folder edits survive.
        if (this.change(state => mergeSnapshot(state, result), cx)) this.error = null;
      } catch (error) { if (generation === this.generation) this.error = error.message; }
      finally { if (generation === this.generation) this.busy = false; cx.notify(); }
    });
  }

  loadOlder(cx) {
    this.readState();
    if (this.busy || !this.state?.history.hasNext || !this.accounts.some(account => account.host === this.host)) return;
    this.busy = true;
    const snapshot = this.state;
    const generation = this.generation;
    cx.spawn(async cx => {
      try {
        const result = await olderPRs(exec, snapshot);
        if (generation !== this.generation) return;
        if (result && this.change(state => mergeSnapshot(state, result, true), cx)) this.error = null;
      } catch (error) { if (generation === this.generation) this.error = error.message; }
      finally { if (generation === this.generation) this.busy = false; cx.notify(); }
    });
  }

  createFolder(cx) {
    const name = this.newFolder.value();
    if (!name.trim()) return;
    this.change(state => addFolder(state, name, `f${Date.now()}-${Math.random().toString(36).slice(2)}`), cx);
    if (!this.dataError) this.newFolder.set_value("");
  }
  renameFolder(cx) {
    if (!this.editing || !this.renameInput.value().trim()) return;
    this.change(state => updateFolder(state, this.editing, { name: this.renameInput.value() }), cx);
    this.editing = null;
    cx.notify();
  }

  button(id, label, action, t, hint = label) {
    return div().id(id).flex_none().px(6).h(23).flex().items_center().justify_center()
      .rounded(4).text_size(11).text_color(t.muted).role("button").accessibility_label(hint).cursor_pointer().tooltip(hint)
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);
  }

  row(pr, t) {
    const attention = pr.state === "OPEN" && !pr.isDraft &&
      (pr.review === "CHANGES_REQUESTED" || ["FAILURE", "ERROR"].includes(pr.checks) || pr.mergeable === "CONFLICTING");
    const color = pr.state === "MERGED" ? t.ansi5 : pr.state === "CLOSED" ? t.muted :
      pr.isDraft ? t.ansi3 : attention ? t.blocked : t.accent;
    const folder = this.state.assignments[pr.key] ?? null;
    return v_flex().id(`pr-${pr.key}`).flex_none().w_full().px(9).py(8).gap(4).rounded(6)
      .hover(el => el.bg(t.hover))
      .on_hover((hovered, cx) => {
        const next = hovered ? pr.key : this.hoveredPR === pr.key ? null : this.hoveredPR;
        if (next !== this.hoveredPR) { this.hoveredPR = next; cx.notify(); }
      })
      .child(h_flex().w_full().min_w(0).gap(5).items_center()
        .child(div().size(5).rounded(3).flex_none().bg(color))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${pr.repository} #${pr.number}`))
        .child(div().size(28).flex_none().flex().items_center().justify_center()
          .when(this.hoveredPR === pr.key || this.prMenu === pr.key || this.moving === pr.key, el => el.child(
            Popover.new(`pr-actions-${pr.key}`).anchor("top_right").open(this.prMenu === pr.key)
              .on_open_change((open, cx) => {
                if (open) { this.prMenu = pr.key; this.moving = null; }
                else if (this.prMenu === pr.key) this.prMenu = null;
                cx.notify();
              })
              .trigger(div().id(`more-${pr.key}`).size(28).flex().items_center().justify_center().rounded(4)
                .role("button").accessibility_label("PR actions").cursor_pointer().text_color(t.muted)
                .hover(el => el.bg(t.raised).text_color(t.foreground))
                .child(svg("mods/nic-prs/more.svg").size(18)))
              .when(this.prMenu === pr.key, el => el.content(v_flex().w(168).p(4).rounded(6)
                .bg(t.popover).border_1().border_color(t.border).role("menu").accessibility_label("PR actions")
                .child(this.button(`copy-${pr.key}`, "Copy PR link", cx => {
                  cx.write_to_clipboard(pr.url);
                  this.prMenu = null; cx.notify();
                }, t).w_full().h(30).justify_start().text_size(12).role("menu_item"))
                .child(this.button(`move-${pr.key}`, "Move to folder", cx => {
                  this.prMenu = null; this.moving = pr.key; cx.notify();
                }, t).w_full().h(30).justify_start().text_size(12).role("menu_item"))))))))
      .child(div().id(`open-${pr.key}`).w_full().text_size(12).text_color(t.foreground)
        .whitespace_normal().cursor_pointer().hover(el => el.underline())
        .on_click((_e, cx) => cx.open_url(pr.url)).child(pr.title))
      .child(div().text_size(10).text_color(readableText(color, t.surface, t.foreground)).whitespace_normal().child(statusText(pr)))
      .when(this.moving === pr.key, el => el.child(v_flex().id(`move-picker-${pr.key}`).w_full().p(4).gap(2)
        .bg(t.raised).rounded(5).child(div().px(6).text_size(10).text_color(t.muted).child("Move to folder"))
        .children([{ id: null, name: "Unfiled" }, ...this.state.folders].map(item =>
          this.button(`assign-${pr.key}-${item.id ?? "unfiled"}`, `${folder === item.id ? "✓ " : ""}${item.name}`,
            cx => { this.change(state => movePR(state, pr.key, item.id), cx); this.moving = null; }, t)))
        .child(this.button(`cancel-move-${pr.key}`, "Cancel", cx => { this.moving = null; cx.notify(); }, t))));
  }

  group(folder, t) {
    const id = folder?.id ?? "unfiled", rows = visiblePRs(this.state, folder?.id ?? null, this.search.value());
    const collapsed = folder?.collapsed ?? this.unfiledCollapsed;
    const editing = this.editing === id;
    return v_flex().id(`group-${id}`).flex_none().w_full().gap(2)
      .child(h_flex().id(`folder-${id}`).h(30).w_full().px(7).gap(5).items_center().rounded(5).bg(t.surface)
        .cursor_pointer().on_click((_e, cx) => {
          if (folder) this.change(state => updateFolder(state, id, { collapsed: !folder.collapsed }), cx);
          else { this.unfiledCollapsed = !this.unfiledCollapsed; cx.notify(); }
        })
        .child(div().text_size(10).text_color(t.muted).child(collapsed ? "▸" : "▾"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12).text_color(t.foreground).child(folder?.name ?? "Unfiled"))
        .child(div().text_size(10).text_color(t.muted).child(String(rows.length)))
        .when(Boolean(folder), el => el.child(this.button(`options-${id}`, "···", cx => {
          this.managing = this.managing === id ? null : id; this.editing = null; cx.notify();
        }, t, "Folder options"))))
      .when(this.managing === id && Boolean(folder), el => el.child(h_flex().gap(2).px(5).items_center()
        .child(this.button(`rename-${id}`, "Rename", cx => {
          this.editing = id; this.renameInput.set_value(folder.name); this.renameInput.focus(); cx.notify();
        }, t))
        .child(this.button(`up-${id}`, "↑", cx => this.change(state => reorderFolder(state, id, -1), cx), t, "Move folder up"))
        .child(this.button(`down-${id}`, "↓", cx => this.change(state => reorderFolder(state, id, 1), cx), t, "Move folder down"))
        .child(this.button(`delete-${id}`, "Delete", cx => {
          this.change(state => deleteFolder(state, id), cx); this.managing = null; this.editing = null;
        }, t, "Delete folder; its PRs move to Unfiled"))))
      .when(editing, el => el.child(h_flex().px(5).gap(3).items_center()
        .child(Input.new(this.renameInput).flex_1().min_w(0).h(28).px(6).rounded(4).border_1()
          .border_color(t.accent).bg(t.surface).text_size(12).text_color(t.foreground))
        .child(this.button(`save-name-${id}`, "Save", cx => this.renameFolder(cx), t))))
      .when(!collapsed, el => el.children(rows.map(pr => this.row(pr, t)))
        .when(!rows.length, el => el.child(div().px(9).py(8).text_size(11).text_color(t.muted).child("No matching PRs"))));
  }

  render() {
    this.readState();
    const t = theme(), state = this.state;
    const count = state ? Object.values(state.records).filter(pr => state.filter === "All" || pr.state === state.filter.toUpperCase()).length : 0;
    return v_flex().id("prs-root").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.surface).border_1().border_color(t.border).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === "escape") { this.editing = null; this.moving = null; this.prMenu = null; this.managing = null; this.choosingHost = false; cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(43).flex_none().px(12).gap(7).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/nic-prs/pr.svg").size(15).text_color(t.accent))
        .child(div().font_semibold().text_size(13).child("Pull requests"))
        .child(div().flex_1().text_size(10).text_color(t.muted).child(String(count)))
        .child(this.button("refresh-prs", svg("mods/nic-prs/refresh.svg").size(13)
          .when(Boolean(this.busy || this.discovering), el => el.spin(900)), cx => this.detectHosts(cx), t,
          this.busy || this.discovering ? "Refreshing PRs…" : "Refresh PRs")))
      .child(h_flex().px(8).pt(5).gap(3).items_center().flex_none()
        .child(this.button("choose-host", `${this.host}${this.accounts.length > 1 ? " ▾" : ""}`, cx => {
          if (this.accounts.length > 1 && !this.discovering) { this.choosingHost = !this.choosingHost; cx.notify(); }
        }, t, this.accounts.length > 1 ? "Switch GitHub host" : "GitHub host"))
        .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted).child(state?.login ?? "")))
      .when(Boolean(this.choosingHost), el => el.child(v_flex().px(10).py(3).gap(2).flex_none()
        .children(this.accounts.map(account => this.button(`host-${account.host}`,
          `${account.host === this.host ? "✓ " : ""}${account.host} · ${account.login}`,
          cx => this.selectHost(account.host, cx), t, `Use ${account.host}`)))))
      .when(Boolean(this.dataError || this.error), el => el.child(div().px(12).py(6).text_size(11)
        .text_color(readableText(t.blocked, t.surface, t.foreground)).whitespace_normal().child(this.dataError || this.error)))
      .when(Boolean(state), el => el
        .child(h_flex().px(8).py(7).gap(3).flex_none().children(FILTERS.map(filter =>
          this.button(`filter-${filter}`, filter, cx => {
            this.moving = this.prMenu = null; this.change(state => ({ ...state, filter }), cx);
          }, t).bg(state.filter === filter ? t.selected : t.surface)
            .text_color(state.filter === filter ? t.foreground : t.muted))))
        .child(h_flex().px(10).pb(6).flex_none()
          .child(Input.new(this.search).flex_1().min_w(0).h(28).px(7).rounded(5).border_1()
            .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12)))
        .child(h_flex().px(10).pb(8).gap(4).flex_none().items_center()
          .child(Input.new(this.newFolder).flex_1().min_w(0).h(28).px(7).rounded(5).border_1()
            .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12))
          .child(this.button("add-folder", "+", cx => this.createFolder(cx), t, "Create folder (Enter)")))
        .child(v_flex().id("pr-list").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(7).gap(7)
          .children(state.folders.map(folder => this.group(folder, t))).child(this.group(null, t)))
        .when(state.filter !== "Open", el => el.child(v_flex().px(12).py(8).gap(3).flex_none().border_t(1).border_color(t.border)
            .child(div().text_size(10).text_color(t.muted).child(`${Object.values(state.records).filter(pr => pr.state !== "OPEN").length} history PRs loaded · ${state.history.total} on GitHub`))
            .when(state.history.hasNext, el => el.child(this.button("load-older", this.busy ? "Loading…" : "Load older PRs", cx => this.loadOlder(cx), t))))));
  }
}
