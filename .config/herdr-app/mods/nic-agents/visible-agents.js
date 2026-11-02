// Native status reports win. Wrapped agents without reports remain selectable,
// with an explicit unknown status; titles never imply a lifecycle state.
const basename = value => String(value ?? "").split(/[\\/]/).pop();
const PROGRAMS = { codex: "Codex", claude: "Claude Code", pi: "Pi" };
import { hookStatus, codexSession } from "./codex-status.js";

export function agentProgram(terminal, pane) {
  const foreground = terminal.foreground;
  const command = basename(foreground?.name || foreground?.argv?.[0]);
  let kind;
  if (command === "declawd") {
    const args = foreground.argv ?? [];
    kind = args.includes("--codex") ? "codex" : args.includes("--pi") ? "pi" : "claude";
  } else if (command === "herdr") {
    // This migration labels only direct agent attachments. Ordinary Herdr
    // clients and non-agent terminal attachments must stay out of this list.
    const args = foreground.argv ?? [];
    const target = terminal.labels?.["herdr.legacy.pane"];
    kind = terminal.labels?.["herdr.legacy.agent"];
    const attachment = args.findIndex((arg, i) => arg === "agent" && args[i + 1] === "attach");
    if (!PROGRAMS[kind] || !target || attachment < 0 || args[attachment + 2] !== target) return null;
  } else if (PROGRAMS[command]) kind = command;
  else if (pane.program?.agent) return pane.program;
  else return null;
  return { ...pane.program, key: kind, name: PROGRAMS[kind],
    icon: `icons/${kind}.svg`, tint: kind === "pi", shell: false, agent: true };
}

export function visibleAgents(reported, spaces, panes, terminals, legacy = {}, now = Date.now(), codex = {}) {
  const native = new Map(reported.map(a => [a.address, a]));
  const live = new Map(terminals.filter(t => t.state === "live").map(t => [t.address, t]));
  const result = [];
  for (const space of spaces) for (const tab of space.tabs) {
    for (const pane of panes.filter(p => p.tab === tab.id && p.terminal)) {
      const existing = native.get(pane.terminal);
      if (existing) { result.push(existing); native.delete(existing.address); continue; }
      const terminal = live.get(pane.terminal);
      if (!terminal) continue;
      const program = agentProgram(terminal, pane);
      if (!program) continue;
      const attachment = legacyAttachment(terminal);
      const snapshot = attachment && legacy[attachment.session];
      const source = snapshot && now - snapshot.checkedAt <= 8000
        ? snapshot.agents.find(a => a.pane_id === attachment.pane && a.agent === program.key) : null;
      const known = ["idle", "working", "done", "blocked", "error"].includes(source?.agent_status);
      const direct = hookStatus(codex[codexSession(terminal)], terminal);
      result.push({ address: terminal.address, pane: pane.pane, space: space.id,
        space_name: space.name, tab: tab.id, tab_index: tab.index, tab_name: tab.name,
        title: terminal.labels?.["herdr.legacy.title"] || pane.title || terminal.title,
        program, app: null, status: direct || (known ? (source.agent_status === "error" ? "blocked" : source.agent_status) : "unknown"),
        status_source: direct ? "codex-hook" : known ? "legacy" : null,
        seq: terminal.created_ms ?? 0, pinned: terminal.labels?.["herdr.pinned"] === "true",
        focused: pane.focused });
    }
  }
  // Retain any native rows outside a not-yet-complete layout snapshot.
  return [...result, ...native.values()];
}

// Match an explicit attachment, never a title or a stale migration label.
export function legacyAttachment(terminal) {
  const foreground = terminal.foreground;
  if (terminal.state !== "live" || basename(foreground?.name || foreground?.argv?.[0]) !== "herdr") return null;
  const args = foreground.argv ?? [];
  const at = args.findIndex((arg, i) => arg === "agent" && args[i + 1] === "attach");
  const pane = terminal.labels?.["herdr.legacy.pane"];
  if (at < 0 || !pane || args[at + 2] !== pane || !PROGRAMS[terminal.labels?.["herdr.legacy.agent"]]) return null;
  const flag = args.indexOf("--session");
  return { session: flag >= 0 ? args[flag + 1] : "default", pane };
}
