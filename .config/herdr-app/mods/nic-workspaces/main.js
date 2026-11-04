import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, agents, focused, window, theme, home, exec, hc, readTextFile, run,
  shared, openOverlay, setAgentOrder, nextCommand } from "herdr";
import { visibleAgents, legacyAttachment } from "./visible-agents.js";
import * as fs from "fs/promises";
import { directCodex, codexSession, newBindings } from "./codex-status.js";
import { workspaceTree, agentOrder } from "./workspace-tree.js";
import { readAttention } from "./read-attention.js";
import { draftTargets, applyDrafts } from "./draft-status.js";

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
    this.codexStarts = {};
    this.codexBusy = false;
    cx.timer.every(1500, cx => this.refreshCodex(cx));
    this.refreshCodex(cx);
    this.drafts = {};
    this.draftsBusy = false;
    cx.timer.every(3000, cx => this.refreshDrafts(cx));
    this.refreshDrafts(cx);
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

  save() {
    localStorage.setItem("folded-spaces", JSON.stringify([...this.folded]));
    localStorage.setItem("expanded-tabs", JSON.stringify([...this.expanded]));
    localStorage.setItem("expanded-workers", JSON.stringify([...this.workers]));
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
    for (const terminal of all.filter(directCodex)) {
      if (this.codexStarts[terminal.address]?.pid !== terminal.foreground.pid)
        this.codexStarts[terminal.address] = { pid: terminal.foreground.pid, seenAt: now };
    }
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
        for (const binding of newBindings(all, records, this.codexStarts, Date.now()))
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

  status(status, t) {
    if (!hasIndicator(status)) return null;
    if (status === "working") return svg(art("spinner")).size(12).flex_none()
      .text_color(t.working).spin(900).tooltip("Working");
    if (status === "blocked") return div().px(5).h(17).flex_none().rounded(4)
      .bg(t.blocked + "26").text_color(t.blocked).text_size(10).font_semibold()
      .tooltip("Needs your attention").child("!");
    if (status === "unknown") return div().w(13).flex_none().text_size(11).text_color(t.muted)
      .tooltip("Status unavailable: no current native, hook, or source-server status").child("?");
    return div().size(7).mx(3).flex_none().rounded(4).bg(t.done)
      .tooltip("Done — unread; viewing the agent clears this dot");
  }

  disclosure(id, open, t, action) {
    return div().id(id).size(18).flex_none().flex().items_center().justify_center()
      .rounded(4).text_color(t.dim).hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx))
      .child(svg(art(open ? "chevron-down" : "chevron-right")).size(10));
  }

  menu(tab, target) {
    openOverlay({ mod: "nic-menu", kind: "popup", width: 280, height: 330, props: { tab, target } });
  }

  workerRows(nodes, t, depth = 0) {
    return nodes.flatMap(node => [h_flex().id(`worker-${node.id}`).h(25).flex_none()
      .pl(43 + depth * 10).pr(9).gap(7).items_center().rounded(5)
      .hover(el => el.bg(t.hover)).on_click(() => run("terminal.peek", { terminal: node.terminal }))
      .child(icon(node.program, "terminal", t, 12))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).text_size(11.5)
        .tooltip(node.title).child(node.title))
      .when(hasIndicator(node.status), el => el.child(this.status(node.status, t))), ...this.workerRows(node.children, t, depth + 1)]);
  }

  paneRows(pane, t) {
    const open = this.workers.has(pane.id);
    return [h_flex().id(`pane-${pane.id}`).h(27).flex_none().pl(8).pr(9).gap(7)
      .items_center().rounded(6).when(pane.focused, el => el.bg(t.accent + "1f"))
      .hover(el => el.bg(pane.focused ? t.accent + "2b" : t.hover))
      .on_click(() => perform(pane.actions))
      .on_mouse_down("right", () => this.menu("pane", { pane: pane.pane, terminal: pane.terminal }))
      .child(pane.children.length ? this.disclosure(`kids-${pane.id}`, open, t,
        cx => this.toggle(this.workers, pane.id, cx)) : div().w(18).flex_none())
      .child(icon(pane.program, pane.mod ? "file-text" : "terminal", t))
      .child(div().flex_1().min_w(0).truncate().text_size(12)
        .text_color(pane.focused ? t.accent : t.muted).tooltip(pane.title).child(pane.title))
      .when(pane.draft, el => el.child(this.draftBadge(1, t)))
      .when(hasIndicator(pane.status), el => el.child(this.status(pane.status, t))), ...(open ? this.workerRows(pane.children, t) : [])];
  }

  tabRows(space, tab, t) {
    const split = tab.leaves.length > 1;
    const hasWorkers = Boolean(tab.single?.children.length);
    const open = split ? this.expanded.has(tab.id) : this.workers.has(tab.single?.id);
    const on = space.active && tab.active;
    const row = h_flex().id(`tab-${tab.id}`).h(29).flex_none().pl(16).pr(9).gap(7)
      .items_center().rounded(6).when(on, el => el.bg(t.accent + "1f"))
      .hover(el => el.bg(on ? t.accent + "2b" : t.hover))
      .on_click(() => perform(tab.actions))
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
      .when(hasIndicator(tab.status), el => el.child(this.status(tab.status, t)));
    if (!open) return [row];
    if (!split) return [row, ...this.workerRows(tab.single.children, t)];
    return [row, v_flex().id(`pane-group-${tab.id}`).flex_none().min_w(0)
      .ml(25).pl(8).pb(2).mb(4).border_l(1).border_color(t.border)
      .children(tab.leaves.flatMap(p => this.paneRows(p, t)))];
  }

  spaceRows(space, t, narrow, index) {
    const folded = this.folded.has(space.id);
    const color = shared("space.colors")?.[space.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : t[color];
    const detail = `${space.tabs.length} tabs · ${space.paneCount} panes · ${space.agentCount} agents`;
    const row = h_flex().id(`space-${space.id}`).h(33).flex_none().px(narrow ? 3 : 6).gap(6)
      .items_center().rounded(6).when(space.active, el => el.bg(t.selected))
      .hover(el => el.bg(t.hover)).tooltip(`${space.name}${space.machine ? ` · ${space.machine}` : ""}\n${detail}`)
      .on_click(() => run("space.select", { id: space.id }))
      .on_mouse_down("right", () => this.menu("space", { id: space.id }))
      .when(!narrow, el => el.child(this.disclosure(`fold-${space.id}`, !folded, t,
        cx => this.toggle(this.folded, space.id, cx))))
      .child(div().size(17).flex_none().rounded(4).bg(fill).flex().items_center().justify_center()
        .text_color("#ffffff").text_size(10).font_semibold()
        .child(narrow ? String(index + 1) : [...space.name][0]?.toUpperCase() || "?"))
      .when(!narrow, el => el.child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold()
        .text_color(t.foreground).child(space.name))
        .child(div().flex_none().text_size(10).text_color(t.dim).tooltip(detail).child(String(space.agentCount))))
      .when(space.draftCount > 0 && (folded || narrow), el => el.child(this.draftBadge(space.draftCount, t, narrow)))
      .when(hasIndicator(space.status), el => el.child(this.status(space.status, t)));
    return [row, ...(!folded && !narrow ? space.tabs.flatMap(tab => this.tabRows(space, tab, t)) : [])];
  }

  render() {
    const t = theme();
    const sp = spaces(), ps = panes(), ts = terminals();
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
    return v_flex().id("workspaces-root").size_full().min_h(0).bg(t.chrome)
      .on_size_change((size, cx) => {
        const was = (this.width ?? 268) < 160;
        this.width = size.width;
        if (was !== (this.width < 160)) cx.notify();
      })
      .child(h_flex().h(29).flex_none().pl(narrow ? 4 : 16).pr(10).gap(6).items_center()
        .text_size(11).text_color(t.dim)
        .when(!narrow, el => el.child(div().flex_1().child("Workspaces"))
          .child(div().tooltip("Open recognized agent sessions").child(`${count} agents`)))
        .child(div().id("new-space").size(22).flex_none().rounded(5).flex().items_center().justify_center()
          .hover(el => el.bg(t.hover).text_color(t.foreground)).tooltip("New space")
          .on_click(() => run("space.new")).child(svg(art("plus")).size(12))))
      .child(v_flex().flex_1().min_h(0).px(narrow ? 4 : 7).pb(10)
        .overflow_y_scrollbar().children(tree.flatMap((space, i) => this.spaceRows(space, t, narrow, i))));
  }
}
