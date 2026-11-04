// Resolve the clicked row, never whichever terminal happens to have focus.
export function moveSource(context, panes, terminals) {
  const target = context?.target ?? {};
  const matches = context?.tab === "pane" ? panes.filter(p => p.pane === target.pane && p.terminal === target.terminal) :
    context?.tab === "tab" ? panes.filter(p => p.tab === target.id) : [];
  if (matches.length !== 1 || !matches[0].terminal) return null;
  const pane = matches[0];
  const terminal = terminals.find(t => t.address === pane.terminal && t.state === "live");
  return terminal ? { terminal: pane.terminal, pane: pane.pane, tab: pane.tab } : null;
}

export function moveTargets(source, spaces, panes, terminals) {
  const live = new Set(terminals.filter(t => t.state === "live").map(t => t.address));
  const from = spaces.find(s => s.tabs.some(t => t.id === source?.tab));
  if (!from || from.machine) return [];
  return spaces.filter(s => !s.machine).flatMap(s => s.tabs.flatMap(t => {
    if (t.id === source.tab) return [];
    const targets = panes.filter(p => p.tab === t.id && p.terminal && live.has(p.terminal));
    const pane = targets.find(p => p.focused) ?? targets[0];
    return pane ? [{ pane: pane.pane, tab: t.id, space: s.id, name: `${s.name} / ${t.name}` }] : [];
  }));
}
