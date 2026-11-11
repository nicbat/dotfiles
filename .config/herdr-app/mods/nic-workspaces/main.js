import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, agents, focused, window, theme, home, exec, hc, readTextFile, run,
  shared, setShared, props, openOverlay, setAgentOrder, nextCommand } from "herdr";
import { visibleAgents, legacyAttachment } from "./visible-agents.js";
import * as fs from "fs/promises";
import { directCodex, codexSession, newBindings } from "./codex-status.js";
import { workspaceTree, agentOrder } from "./workspace-tree.js";
import { readAttention } from "./read-attention.js";
import { draftTargets, applyDrafts, backgroundLabel } from "./draft-status.js";
import { TabDrag } from "./drag-ui.js";
import { SlimScrollbar } from "./slim-scrollbar.js";

const art = name => `mods/workspace-chrome/${name}.svg`;
const perform = actions => actions.forEach(([command, args]) => run(command, args));
const hasIndicator = status => ["done", "working", "blocked", "unknown"].includes(status);
function saved(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]")); }
  catch (_) { return new Set(); }
}
function icon(program, fallback, t, size = 15) {
  if (!program?.icon) return svg(art(fallback)).size(size).flex_none().text_color(t.muted);
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(t.muted) :
    image(program.icon).w(size).h(size).flex_none();
}

export default class Workspaces extends View {
  init(_props, cx) {
    this.scrollbar = new SlimScrollbar();
    this.scrollbar.activity(cx);
    this.drag = new TabDrag(cx);
    this.folded = saved("folded-spaces");
    this.expanded = saved("expanded-tabs");
    this.workers = saved("expanded-workers");
    try {
      const read = JSON.parse(localStorage.getItem("read-completions") ?? "{}");
      this.readSeen = Object.fromEntries(Object.entries(read).filter(([, value]) => typeof value === "string"));
    } catch (_) { this.readSeen = {}; }
    this.legacy = {};
    this.legacyBusy = false;
    cx.timer.every(3000, cx => this.refreshLegacy(cx));
    this.refreshLegacy(cx);
    this.codex = {};
    try { this.codexStarts = JSON.parse(localStorage.getItem("codex-starts") ?? "{}"); }
    catch (_) { this.codexStarts = {}; }
    this.codexBusy = false;
    cx.timer.every(1500, cx => this.refreshCodex(cx));
    this.refreshCodex(cx);
    this.drafts = {};
    this.draftsBusy = false;
    cx.timer.every(3000, cx => this.refreshDrafts(cx));
    this.refreshDrafts(cx);
    // Agents can't run ps, so map each terminal's processes and session for them.
    this.mapBusy = false;
    cx.timer.every(10000, cx => this.refreshMap(cx));
    this.refreshMap(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "expand-all") {
          this.folded.clear();
          this.expanded = new Set(spaces().flatMap(s => s.tabs.map(t => t.id)));
          this.save();
        } else if (command === "collapse-splits") {
          this.expanded.clear();
          this.save();
        } else if (command === "fold-all") {
          this.folded = new Set(spaces().map(s => s.id));
          this.save();
        } else if (command === "move-to-tab") {
          const at = focused();
          if (at?.pane && at?.terminal) openOverlay({ mod: "nic-menu", kind: "dialog", width: 620, height: 480,
            props: { tab: "pane", target: { pane: at.pane, terminal: at.terminal }, movePicker: true } });
        }
        cx.notify();
      }
    });
  }

  close() { this.drag?.close(); this.scrollbar?.close(); }

  save() {
    localStorage.setItem("folded-spaces", JSON.stringify([...this.folded]));
    localStorage.setItem("expanded-tabs", JSON.stringify([...this.expanded]));
    localStorage.setItem("expanded-workers", JSON.stringify([...this.workers]));
  }

  refreshMap(cx) {
    if (this.mapBusy) return;
    this.mapBusy = true;
    cx.spawn(async () => {
      try { await exec("python3", [`${home()}/.local/bin/herdr-agent.py`, "map"]); }
      catch (_) { /* whoami and last report a stale map. */ }
      finally { this.mapBusy = false; }
    });
  }

  refreshDrafts(cx) {
    if (this.draftsBusy) return;
    const all = terminals();
    const list = visibleAgents(agents(), spaces(), panes(), all, this.legacy, Date.now(), this.codex);
    const targets = draftTargets(list, all);
    if (!targets.length) { this.drafts = {}; return; }
    this.draftsBusy = true;
    cx.spawn(async cx => {
      try {
        const reply = await exec("python3", [`${home()}/.local/bin/herdr-draft-status.py`, JSON.stringify(targets)]);
        const data = JSON.parse(reply.stdout);
        if (reply.code !== 0 || !Array.isArray(data)) throw new Error("Draft observer unavailable");
        this.drafts = Object.fromEntries(data.map(o => [o.address, o]));
      } catch (_) { this.drafts = {}; }
      finally { this.draftsBusy = false; cx.notify(); }
    });
  }

  draftBadge(count, t, compact = false) {
    return div().flex_none().px(compact ? 3 : 5).h(17).rounded(4).text_size(10)
      .text_color(t.ansi3).bg(t.ansi3 + "18")
      .tooltip("Draft prompt — unsubmitted input; the agent's activity is shown separately")
      .child(compact ? "✎" : count > 1 ? `${count} drafts` : "Draft");
  }

  toggle(set, id, cx) {
    set.has(id) ? set.delete(id) : set.add(id);
    this.save();
    cx.stop_propagation();
    cx.notify();
  }

  refreshCodex(cx) {
    if (this.codexBusy) return;
    const all = terminals();
    const now = Date.now();
    let startsChanged = false;
    for (const terminal of all.filter(directCodex)) {
      if (this.codexStarts[terminal.address]?.pid !== terminal.foreground.pid) {
        this.codexStarts[terminal.address] = { pid: terminal.foreground.pid, seenAt: now };
        startsChanged = true;
      }
    }
    for (const address of Object.keys(this.codexStarts)) {
      if (!all.some(t => t.address === address && directCodex(t))) {
        delete this.codexStarts[address]; startsChanged = true;
      }
    }
    if (startsChanged) localStorage.setItem("codex-starts", JSON.stringify(this.codexStarts));
    const sessions = new Set(all.map(codexSession).filter(Boolean));
    const unbound = all.some(t => directCodex(t) && !codexSession(t));
    this.codexBusy = true;
    cx.spawn(async cx => {
      const folder = `${home()}/.local/state/herdr-native-status`;
      const records = [];
      try {
        const names = unbound ? await fs.readdir(folder) : [...sessions].map(s => `${s}.json`);
        await Promise.all(names.filter(n => /^[A-Za-z0-9_-]{1,128}\.json$/.test(n)).map(async name => {
          try {
            const record = JSON.parse(await readTextFile(`${folder}/${name}`));
            if (record && record.session_id === name.slice(0, -5)) records.push(record);
          } catch (_) { /* No record means unavailable. */ }
        }));
        for (const binding of newBindings(terminals(), records, this.codexStarts, Date.now()))
          await hc(["label", binding.terminal, `herdr.codex.session=${binding.session}`, `herdr.codex.pid=${binding.pid}`]);
      } catch (_) { /* Missing observer directory is expected before the first event. */ }
      finally {
        this.codex = Object.fromEntries(records.map(record => [record.session_id, record]));
        this.codexBusy = false;
        cx.notify();
      }
    });
  }

  // Only local attachments are bridged to the local legacy server. Remote native
  // reports still work; remote legacy attachments stay explicitly unknown.
  refreshLegacy(cx) {
    if (this.legacyBusy) { cx.notify(); return; }
    const sessions = [...new Set(terminals().filter(t => !t.address.includes("/"))
      .map(legacyAttachment).filter(Boolean).map(a => a.session))];
    for (const session of Object.keys(this.legacy)) if (!sessions.includes(session)) delete this.legacy[session];
    if (!sessions.length) return;
    this.legacyBusy = true;
    cx.spawn(async cx => {
      try {
        await Promise.all(sessions.map(async session => {
          try {
            const reply = await exec("herdr", ["--session", session, "agent", "list"]);
            const data = JSON.parse(reply.stdout);
            if (reply.code !== 0 || !Array.isArray(data.result?.agents)) throw new Error("Agent list unavailable");
            this.legacy[session] = { checkedAt: Date.now(), agents: data.result.agents };
          } catch (_) { delete this.legacy[session]; }
        }));
      } finally { this.legacyBusy = false; cx.notify(); }
    });
  }

  status(status, t, id, compact = false) {
    // Reserve the same end column even when an agent is idle or unavailable.
    return div().id(`status-${id}`).w(compact ? 13 : 22).h(22).flex_none()
      .flex().items_center().justify_center()
      .when(status === "working", el => el.tooltip("Working")
        .child(svg(art("spinner")).size(12).text_color(t.working).spin(900)))
      .when(status === "blocked", el => el.tooltip("Needs your attention")
        .child(div().px(5).h(17).rounded(4).bg(t.blocked + "26")
          .text_color(t.blocked).text_size(10).font_semibold().child("!")))
      .when(status === "unknown", el => el.text_size(11).text_color(t.muted)
        .tooltip("Status unavailable: no current native, hook, or source-server status").child("?"))
      .when(status === "done", el => el.tooltip("Done — unread; viewing the agent clears this dot")
        .child(div().size(7).rounded(4).bg(t.done)));
  }

  disclosure(id, open, t, action) {
    return div().id(id).size(18).flex_none().flex().items_center().justify_center()
      .rounded(4).text_color(t.dim).hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag?.cancel(false); })
      .on_click((_e, cx) => action(cx))
      .child(svg(art(open ? "chevron-down" : "chevron-right")).size(10));
  }

  menu(tab, target) {
    openOverlay({ mod: "nic-menu", kind: "popup", frame: "none", width: 228, height: 330, props: { frameless: true, tab, target } });
  }

  workerRows(nodes, t, depth = 0) {
    return nodes.flatMap(node => [h_flex().id(`worker-${node.id}`).h(25).flex_none()
      .pl(43 + depth * 10).pr(3).gap(7).items_center().rounded(5)
      .hover(el => el.bg(t.hover)).on_click(() => run("terminal.peek", { terminal: node.terminal }))
      .child(icon(node.program, "terminal", t, 12))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).text_size(11.5)
        .tooltip(node.title).child(node.title))
      .child(this.status(node.status, t, `worker-${node.id}`)), ...this.workerRows(node.children, t, depth + 1)]);
  }

  backgroundBadge(id, shells, unknown, t) {
    return h_flex().id(`background-${id}`).h(17).flex_none().gap(3).items_center()
      .text_size(10.5).text_color(t.ansi3)
      .tooltip(`${backgroundLabel(shells, unknown)} reported by live agent footers.${unknown ? " + means another count is unavailable." : ""}`)
      .child(svg(art("terminal")).size(11).flex_none())
      .child(`${shells}${unknown ? "+" : ""}`);
  }

  paneRows(pane, t) {
    const open = this.workers.has(pane.id);
    const row = h_flex().id(`pane-${pane.id}`).h(27).flex_none().pl(8).pr(3).gap(7)
      .items_center().rounded(6).when(pane.focused, el => el.bg(t.accent + "1f"))
      .hover(el => el.bg(pane.focused ? t.accent + "2b" : t.hover))
      .on_click(() => { if (!this.drag?.blockClick()) perform(pane.actions); })
      .on_mouse_down("right", () => this.menu("pane", { pane: pane.pane, terminal: pane.terminal }))
      .child(pane.children.length ? this.disclosure(`kids-${pane.id}`, open, t,
        cx => this.toggle(this.workers, pane.id, cx)) : div().w(18).flex_none())
      .child(icon(pane.program, pane.mod ? "file-text" : "terminal", t))
      .child(div().flex_1().min_w(0).truncate().text_size(12)
        .text_color(pane.focused ? t.accent : t.muted).tooltip(pane.title).child(pane.title))
      .when(pane.draft, el => el.child(this.draftBadge(1, t)))
      .when(pane.shells > 0, el => el.child(this.backgroundBadge(pane.id, pane.shells, 0, t)))
      .child(this.status(pane.status, t, `pane-${pane.id}`));
    return [this.drag ? this.drag.row(row, "pane", pane.pane, "vertical", t) : row,
      ...(open ? this.workerRows(pane.children, t) : [])];
  }

  tabRows(space, tab, t) {
    const split = tab.leaves.length > 1;
    const hasWorkers = Boolean(tab.single?.children.length);
    const open = split ? this.expanded.has(tab.id) : this.workers.has(tab.single?.id);
    const on = space.active && tab.active;
    const row = h_flex().id(`tab-${tab.id}`).h(29).flex_none().pl(16).pr(3).gap(7)
      .items_center().rounded(6).when(on, el => el.bg(t.accent + "1f"))
      .hover(el => el.bg(on ? t.accent + "2b" : t.hover))
      .on_click(() => { if (!this.drag?.blockClick()) perform(tab.actions); })
      .on_mouse_down("right", () => this.menu("tab", { id: tab.id, space: space.id }))
      .child(split || hasWorkers ? this.disclosure(`expand-${tab.id}`, open, t, cx =>
        this.toggle(split ? this.expanded : this.workers, split ? tab.id : tab.single.id, cx)) : div().w(18).flex_none())
      .child(split ? svg(art("layers")).size(15).flex_none().text_color(t.dim) :
        icon(tab.single?.program, tab.single?.mod ? "file-text" : "terminal", t))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5)
        .text_color(on ? t.foreground : t.muted).when(on, el => el.font_semibold())
        .tooltip(tab.title + (tab.settled ? " · Settled" : "")).child(tab.title))
      .when(split, el => el.child(div().flex_none().text_color(t.dim).text_size(10.5)
        .tooltip(`${tab.leaves.length} panes · ${tab.agentCount} agents`).child(String(tab.leaves.length))))
      .when(tab.draftCount > 0 && (!split || !open), el => el.child(this.draftBadge(tab.draftCount, t)))
      .when(tab.shells > 0 && (!split || !open), el => el.child(this.backgroundBadge(tab.id, tab.shells, tab.shellUnknown, t)))
      .child(this.status(tab.status, t, `tab-${tab.id}`));
    const draggable = this.drag ? this.drag.row(row, "tab", tab.id, "vertical", t) : row;
    if (!open) return [draggable];
    if (!split) return [draggable, ...this.workerRows(tab.single.children, t)];
    return [draggable, v_flex().id(`pane-group-${tab.id}`).flex_none().min_w(0)
      .ml(25).pl(8).pb(2).mb(4).border_l(1).border_color(t.border)
      .children(tab.leaves.flatMap(p => this.paneRows(p, t)))];
  }

  // On the rail: a centred tile, its status a dot on the corner, drafts a pen below it.
  railRow(space, t, fill, detail, index) {
    const dot = { working: t.working, blocked: t.blocked, done: t.done, unknown: t.muted }[space.status];
    const label = { working: "Working", blocked: "Needs your attention", done: "Done — unread", unknown: "Status unavailable" }[space.status];
    return h_flex().id(`space-${space.id}`).h(28).w_full().flex_none().justify_center().items_center().rounded(6)
      .when(space.active, el => el.bg(t.selected)).hover(el => el.bg(t.hover))
      .tooltip(`${space.name}${space.machine ? ` · ${space.machine}` : ""}\n${detail}${label ? `\n${label}` : ""}`)
      .on_click(() => run("space.select", { id: space.id }))
      .on_mouse_down("right", () => this.menu("space", { id: space.id }))
      .child(div().relative().size(20).flex_none().rounded(5).bg(fill).flex().items_center().justify_center()
        .text_color("#ffffff").text_size(11).font_semibold().child([...space.name][0]?.toUpperCase() || "?")
        .when(Boolean(dot), el => el.child(div().absolute().top(-3).right(-3).size(space.status === "blocked" ? 10 : 8)
          .rounded_full().bg(dot).border_2().border_color(space.active ? t.selected : t.chrome)))
        .when(space.draftCount > 0, el => el.child(div().absolute().bottom(-4).right(-5).text_size(9)
          .text_color(t.foreground).child("✎"))));
  }

  spaceRows(space, t, narrow, index) {
    const folded = this.folded.has(space.id);
    const hovered = this.hoveredSpace === space.id;
    const color = shared("space.colors")?.[space.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : t[color];
    const detail = `${space.tabs.length} tabs · ${space.paneCount} panes · ${space.agentCount} agents`;
    if (narrow) return [this.railRow(space, t, fill, detail, index)];
    const row = h_flex().id(`space-${space.id}`).h(33).flex_none().pl(narrow ? 3 : 6).pr(3).gap(6)
      .items_center().rounded(6).when(space.active && (folded || narrow), el => el.bg(t.selected))
      .hover(el => el.bg(t.hover)).tooltip(`${space.name}${space.machine ? ` · ${space.machine}` : ""}\n${detail}`)
      .on_hover((over, cx) => {
        const next = over ? space.id : this.hoveredSpace === space.id ? null : this.hoveredSpace;
        if (next !== this.hoveredSpace) { this.hoveredSpace = next; cx.notify(); }
      })
      .on_click(() => run("space.select", { id: space.id }))
      .on_mouse_down("right", () => this.menu("space", { id: space.id }))
      .when(!narrow, el => el.child(this.disclosure(`fold-${space.id}`, !folded, t,
        cx => this.toggle(this.folded, space.id, cx))))
      .child(div().size(17).flex_none().rounded(4).bg(fill).flex().items_center().justify_center()
        .text_color("#ffffff").text_size(10).font_semibold()
        .child(narrow ? String(index + 1) : [...space.name][0]?.toUpperCase() || "?"))
      .when(!narrow, el => el.child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold()
        .text_color(t.foreground).child(space.name)))
      .when(space.draftCount > 0 && (folded || narrow), el => el.child(this.draftBadge(space.draftCount, t, narrow)))
      .when(folded && !narrow && space.shells > 0, el => el.child(this.backgroundBadge(space.id, space.shells, space.shellUnknown, t)))
      .when(!narrow, el => el.child(this.status(space.status, t, `space-${space.id}`))
        .child(div().id(`space-action-${space.id}`).size(22).flex_none().rounded(5)
          .flex().items_center().justify_center().text_size(10).text_color(t.dim)
          .tooltip(hovered ? `New tab in ${space.name}` : detail)
          .when(hovered, el => el.hover(el => el.bg(t.hover).text_color(t.foreground))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              run("tab.new", { space: space.id });
            }).child(svg(art("plus")).id(`space-plus-${space.id}`).size(12)))
          .when(!hovered, el => el.child(String(space.agentCount)))))
      .when(narrow && hasIndicator(space.status), el => el.child(this.status(space.status, t, `space-${space.id}`, true)));
    return [row, ...(!folded && !narrow ? space.tabs.flatMap(tab => this.tabRows(space, tab, t)) : [])];
  }

  render() {
    const t = theme();
    const sp = spaces(), ps = panes(), ts = terminals();
    const merged = shared("nic.tabs.merged");
    if (merged?.token && localStorage.getItem("last-merge-token") !== merged.token) {
      const destination = sp.find(s => s.tabs.some(tab => tab.id === merged.tab));
      if (destination) {
        this.expanded.add(merged.tab);
        this.folded.delete(destination.id);
        this.save();
        localStorage.setItem("last-merge-token", merged.token);
      }
    }
    // A remote attachment must never borrow a local session's status.
    const localPanes = ps.filter(p => !p.terminal?.includes("/"));
    const local = visibleAgents(agents().filter(a => !a.address.includes("/")), sp, localPanes, ts, this.legacy, Date.now(), this.codex);
    const remote = visibleAgents(agents().filter(a => a.address.includes("/")), sp,
      ps.filter(p => p.terminal?.includes("/")), ts);
    const attention = readAttention(workspaceTree(sp, ps, ts, applyDrafts([...local, ...remote], ts, this.drafts), home()),
      this.readSeen ?? {}, focused(), window()?.active === true);
    this.readSeen = attention.seen;
    if (attention.changed) localStorage.setItem("read-completions", JSON.stringify(this.readSeen));
    const tree = attention.tree;
    setAgentOrder(agentOrder(tree));
    const narrow = (this.width ?? 268) < 160;
    const count = tree.reduce((n, s) => n + s.agentCount, 0);
    if (shared("nic.sidebar.workspaces-count") !== count) setShared("nic.sidebar.workspaces-count", count);
    const root = v_flex().id("workspaces-root").size_full().min_h(0).bg(t.chrome)
      .on_size_change((size, cx) => {
        const was = (this.width ?? 268) < 160;
        this.width = size.width;
        if (props()?.section) {
          const key = `nic.sidebar.height.${props().section}`;
          if (shared(key) !== size.height + 30) setShared(key, size.height + 30);
        }
        if (was !== (this.width < 160)) cx.notify();
      })
      .when(!props()?.hideHeader, el => el.child(h_flex().h(29).flex_none().pl(narrow ? 4 : 16).pr(12).gap(6).items_center()
        .text_size(11).text_color(t.dim)
        .when(!narrow, el => el.child(div().flex_1().child("Workspaces"))
          .child(div().tooltip("Open recognized agent sessions").child(`${count} agents`)))
        .child(div().id("new-space").size(22).flex_none().rounded(5).flex().items_center().justify_center()
          .hover(el => el.bg(t.hover).text_color(t.foreground)).tooltip("New space")
          .on_click(() => run("space.new")).child(svg(art("plus")).size(12)))))
      .child((this.scrollbar ??= new SlimScrollbar()).wrap(v_flex().id("workspace-list-content")
        .w_full().flex_none().pl(narrow ? 4 : 7).pr(narrow ? 4 : 9).pb(10)
        .children(tree.flatMap((space, i) => this.spaceRows(space, t, narrow, i)))
        // The rail's header holds search, so new space follows the tiles.
        .when(narrow, el => el.child(h_flex().id("rail-new-space").h(28).w_full().flex_none().justify_center().items_center()
          .rounded(6).text_color(t.dim).hover(el => el.bg(t.hover).text_color(t.foreground)).tooltip("New space")
          .on_click(() => run("space.new")).child(svg(art("plus")).size(12)))), "workspace-list"));
    return this.drag ? this.drag.root(root) : root;
  }
}
