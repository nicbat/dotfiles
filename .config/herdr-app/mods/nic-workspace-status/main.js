import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, panes, theme, run, window, keys, exec, home, readTextFile,
  props, shared, setShared } from "herdr";
import { visibleAgents, legacyAttachment } from "./visible-agents.js";
import { codexSession } from "./codex-status.js";

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.legacy = {};
    this.codex = {};
    this.legacyBusy = false;
    this.codexBusy = false;
    cx.timer.every(3000, cx => this.refreshLegacy(cx));
    cx.timer.every(1500, cx => this.refreshCodex(cx));
    this.refreshLegacy(cx);
    this.refreshCodex(cx);
  }

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

  // The sidebar owns new-launch binding. The footer only reads sessions already
  // verified against the live foreground PID, and never writes terminal labels.
  refreshCodex(cx) {
    if (this.codexBusy) return;
    const sessions = [...new Set(terminals().map(codexSession).filter(Boolean))];
    this.codexBusy = true;
    cx.spawn(async cx => {
      const records = {};
      try {
        await Promise.all(sessions.map(async session => {
          try {
            const record = JSON.parse(await readTextFile(`${home()}/.local/state/herdr-native-status/${session}.json`));
            if (record?.session_id === session) records[session] = record;
          } catch (_) { /* Missing or failed records stay unavailable. */ }
        }));
      } finally { this.codex = records; this.codexBusy = false; cx.notify(); }
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const sp = spaces(), ps = panes(), ts = terminals(), reported = agents();
    const space = sp.find(s => s.active);
    const list = [
      ...visibleAgents(reported.filter(a => !a.address.includes("/")), sp,
        ps.filter(p => !p.terminal?.includes("/")), ts, this.legacy, Date.now(), this.codex),
      ...visibleAgents(reported.filter(a => a.address.includes("/")), sp,
        ps.filter(p => p.terminal?.includes("/")), ts)
    ];
    const working = list.filter(a => a.status === "working").length;
    const needs = list.filter(a => a.status === "blocked").length;
    const unknown = list.filter(a => a.status === "unknown").length;
    const activity = { working, total: list.length, needs, unknown };
    const previous = shared("nic.sidebar.agent-counts");
    if (Object.keys(activity).some(key => previous?.[key] !== activity[key])) {
      setShared("nic.sidebar.agent-counts", activity);
    }
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .when(!props()?.hideAgents, el => el.child(h_flex().gap(6).items_center()
        .tooltip(`${working} working · ${list.length} open agent sessions${unknown ? ` · ${unknown} status unavailable` : ""}`)
        .child(div().size(6).rounded(3).bg(working ? t.working : t.dim)).child(`${working}/${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`)))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
