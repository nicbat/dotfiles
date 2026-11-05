// Drafts and shell counts are independent, short-lived hints, never agent status.
export const draftIdentity = t => JSON.stringify([t.address, t.pid, t.foreground?.pid,
  t.created_ms, t.labels?.["herdr.legacy.pane"] ?? null]);

export function draftTargets(list, all) {
  const byAddress = new Map(all.filter(t => t.state === "live").map(t => [t.address, t]));
  return list.flatMap(a => {
    const t = byAddress.get(a.address);
    const kind = a.program?.key === "claude-code" ? "claude" : a.program?.key;
    if (!t || !["codex", "claude", "pi"].includes(kind)) return [];
    return [{ address: t.address, identity: draftIdentity(t), kind, rows: t.rows, cols: t.cols }];
  });
}

export function applyDrafts(list, all, observations = {}, now = Date.now()) {
  const byAddress = new Map(all.filter(t => t.state === "live").map(t => [t.address, t]));
  return list.map(a => {
    const t = byAddress.get(a.address), o = observations[a.address];
    const current = Boolean(t && o && o.identity === draftIdentity(t) &&
      now >= o.checkedAt && now - o.checkedAt <= 8000);
    const shellSupported = ["codex", "claude", "claude-code"].includes(a.program?.key);
    const shells = current && shellSupported && Number.isInteger(o.shells) && o.shells >= 0 && o.shells <= 10000 ? o.shells : null;
    return { ...a, draft: current && o.draft === true, shells, shellSupported };
  });
}

export function backgroundLabel(shells, unknown = 0) {
  return shells > 0 ? `${shells}${unknown ? "+" : ""} background shell${shells === 1 && !unknown ? "" : "s"}` : "";
}
