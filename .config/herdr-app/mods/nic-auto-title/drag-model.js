// Pointer decisions stay independent of App actions. Re-resolve IDs on release.
export const DRAG_KEY = "nic.tabs.drag";
export const BUSY_KEY = "nic.tabs.move-busy";
export const DRAG_MS = 30000;

const tabAt = (spaces, id) => {
  const space = spaces.find(s => s.tabs.some(t => t.id === id));
  return space && { space, tab: space.tabs.find(t => t.id === id) };
};
const processKey = t => [t?.pid ?? null, t?.created_ms ?? null, t?.foreground?.pid ?? null];

export function dragSource(kind, id, spaces, panes, terminals) {
  const leaf = kind === "pane" ? panes.find(p => p.pane === id) : null;
  const at = tabAt(spaces, kind === "tab" ? id : leaf?.tab);
  if (!at || (kind !== "tab" && !leaf)) return null;
  const leaves = kind === "tab" ? panes.filter(p => p.tab === id) : [leaf];
  return { kind, id, tab: at.tab.id, space: at.space.id, machine: at.space.machine ?? null,
    leaves: leaves.map(p => ({ pane: p.pane, terminal: p.terminal ?? null,
      identity: processKey(terminals.find(t => t.address === p.terminal)) })) };
}

export function sameSource(a, b) {
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

export function moved(start, point) {
  return Boolean(start && point && Math.hypot(point.x - start.x, point.y - start.y) >= 6);
}

const unavailable = reason => ({ kind: "invalid", label: reason });
const livePane = (p, terminals) => p?.terminal && !p.terminal.includes("/") &&
  terminals.some(t => t.address === p.terminal && t.state === "live");

export function dropPlan(source, target, event, spaces, panes, terminals) {
  if (!sameSource(source, dragSource(source?.kind, source?.id, spaces, panes, terminals)))
    return unavailable("Source changed — cancel");
  const leaf = target?.kind === "pane" ? panes.find(p => p.pane === target.id) : null;
  const at = tabAt(spaces, target?.kind === "tab" ? target.id : leaf?.tab);
  if (!at) return unavailable("Destination closed");
  const bounds = event?.bounds, point = event?.local_position;
  if (!bounds || !point || point.x < 0 || point.y < 0 || point.x > bounds.width || point.y > bounds.height)
    return unavailable("Drop outside — cancel");
  const ratio = target.axis === "horizontal" ? point.x / bounds.width : point.y / bounds.height;
  if (!Number.isFinite(ratio)) return unavailable("Destination unavailable");
  const edge = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : null;
  if (source.kind === "tab" && target.kind === "tab" && edge) {
    if (source.space !== at.space.id) return unavailable("Reorder within the same space");
    const order = at.space.tabs.map(t => t.id);
    const remaining = order.filter(id => id !== source.tab);
    const to = remaining.indexOf(at.tab.id);
    if (to < 0) return unavailable("Same tab — cancel");
    const index = to + (edge === "after" ? 1 : 0) + 1;
    return { kind: order.indexOf(source.tab) + 1 === index ? "none" : "reorder",
      tab: source.tab, index, target: target.id, axis: target.axis, edge,
      label: edge === "before" ? "Move before" : "Move after" };
  }
  if (source.tab === at.tab.id) return unavailable("Same tab — cancel");
  if (source.machine || at.space.machine) return unavailable("Split local terminals only");
  if (source.leaves.length !== 1)
    return unavailable("Expand the source tab and drag a pane");
  const from = source.leaves[0];
  if (!livePane(from, terminals)) return unavailable("Drag a running terminal pane");
  const choices = panes.filter(p => p.tab === at.tab.id && livePane(p, terminals));
  const to = leaf ?? choices.find(p => p.focused) ?? choices[0];
  if (!livePane(to, terminals)) return unavailable("Choose a terminal destination");
  const direction = event.modifiers?.shift ? "down" : "right";
  return { kind: "merge", terminal: from.terminal, pane: to.pane, target: target.id,
    direction, destinationTab: at.tab.id, label: direction === "down" ? "Split below" : "Split right",
    expected: { source_pane: from.pane, source_tab: source.tab, target_tab: at.tab.id,
      pid: from.identity[0], created_ms: from.identity[1], foreground_pid: from.identity[2] } };
}
