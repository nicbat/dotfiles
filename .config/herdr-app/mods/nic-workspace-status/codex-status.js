const basename = value => String(value ?? "").split(/[\\/]/).pop();
const valid = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function directCodex(terminal) {
  if (terminal.address?.includes("/") || terminal.state !== "live" || !terminal.foreground?.pid) return false;
  const fg = terminal.foreground;
  const name = basename(fg.name || fg.argv?.[0]);
  return name === "codex" || (name === "declawd" && fg.argv?.includes("--codex"));
}

export function codexSession(terminal) {
  const session = terminal.labels?.["herdr.codex.session"];
  return directCodex(terminal) && valid(session) &&
    String(terminal.foreground.pid) === terminal.labels?.["herdr.codex.pid"] ? session : null;
}

export function hookStatus(record, terminal) {
  if (!record || record.ignored || record.session_id !== codexSession(terminal)) return null;
  // Older diagnostic records already contain the actual event but lack state.
  const state = record.state ?? ({ Stop: "done", Interrupt: "idle", UserPromptSubmit: "working",
    PreToolUse: "working", PostToolUse: "working", PermissionRequest: "blocked" })[record.event];
  return ["idle", "working", "done", "blocked", "error"].includes(state) ? state : null;
}

// Bind new launches only when the observed foreground change and SessionStart
// uniquely match in both directions. Ambiguous launches remain unavailable.
export function newBindings(terminals, records, starts, now) {
  const bound = new Set(terminals.map(codexSession).filter(Boolean));
  const pending = terminals.filter(t => directCodex(t) && !codexSession(t));
  const candidates = pending.map(terminal => ({ terminal, records: records.filter(record => {
    const start = starts[terminal.address];
    return !record.ignored && valid(record.session_id) && !bound.has(record.session_id) &&
      start?.pid === terminal.foreground.pid && record.cwd === terminal.foreground.cwd &&
      Number.isFinite(record.session_started_ms) && now >= record.session_started_ms &&
      now - record.session_started_ms < 120000 &&
      record.session_started_ms >= start.seenAt - 10000 &&
      record.session_started_ms - start.seenAt < 90000;
  }) }));
  return candidates.filter(c => c.records.length === 1 && candidates.filter(other =>
    other.records.some(r => r.session_id === c.records[0].session_id)).length === 1)
    .map(c => ({ terminal: c.terminal.address, pid: c.terminal.foreground.pid, session: c.records[0].session_id }));
}
