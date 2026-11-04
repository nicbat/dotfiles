// Drafts are an independent, short-lived presentation hint, never agent status.
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
    const draft = Boolean(t && o?.draft === true && o.identity === draftIdentity(t) &&
      now >= o.checkedAt && now - o.checkedAt <= 8000);
    return { ...a, draft };
  });
}
