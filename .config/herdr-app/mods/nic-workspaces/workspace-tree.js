import { agentLabel } from "./agent-title.js";

const RANK = { unknown: 0, idle: 1, working: 2, done: 3, blocked: 4 };
export function urgent(statuses) {
  return statuses.filter(s => s in RANK).reduce((best, s) =>
    best === null || RANK[s] > RANK[best] ? s : best, null);
}

// Selecting a split tab keeps its selected pane; leaf rows target the exact pane,
// including mod panes. Never fall back to whichever pane the UI happens to show.
export function activation(space, tab, pane = null) {
  return pane ? [["pane.focus", { pane }]] :
    [["space.select", { id: space }], ["tab.select", { id: tab }]];
}

// Workers with panes already have a row elsewhere. Guard malformed parent trees
// and repeated addresses so neither navigation nor the count duplicates them.
export function workerTree(all, parent, visible, seen = new Set([parent])) {
  return all.filter(t => t.parent === parent && t.state === "live" &&
    !visible.has(t.address)).flatMap(t => {
    if (seen.has(t.address)) return [];
    seen.add(t.address);
    const agent = Boolean(t.program?.agent || t.report?.app);
    const raw = t.status === "error" ? "blocked" : t.status;
    const status = agent ? (raw in RANK ? raw : "unknown") : null;
    const children = workerTree(all, t.address, visible, seen);
    return [{ id: t.address, terminal: t.address, title: t.name || t.title ||
      t.template || t.program?.name || t.address, program: t.program,
      agent, status, children }];
  });
}
const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);

export function workspaceTree(spaces, panes, terminals, agents, home = "") {
  const byAgent = new Map(agents.map(a => [a.address, a]));
  const visible = new Set(panes.map(p => p.terminal).filter(Boolean));
  const seenWorkers = new Set(visible);
  return spaces.map(space => {
    const tabs = space.tabs.map(tab => {
      const leaves = panes.filter(p => p.tab === tab.id).map(p => {
        const agent = byAgent.get(p.terminal);
        const program = agent?.program ?? p.program;
        const children = p.terminal ? workerTree(terminals, p.terminal, visible, seenWorkers) : [];
        const title = agent ? agentLabel(agent, tab, panes, home) :
          p.title || program?.name || p.mod || "Pane";
        return { ...p, id: p.pane, title, program, agent: Boolean(agent),
          draft: agent?.draft === true,
          completion_key: agent?.completion_key, seq: agent?.seq,
          status: agent?.status ?? null, children,
          actions: activation(space.id, tab.id, p.pane) };
      });
      const nodes = flatten(leaves);
      const single = leaves.length === 1 ? leaves[0] : null;
      return { ...tab, leaves, single,
        title: tab.name && !/^\d+$/.test(tab.name) ? tab.name : single?.title || `Tab ${tab.index ?? tab.name}`,
        agentCount: nodes.filter(n => n.agent).length,
        draftCount: nodes.filter(n => n.agent && n.draft).length,
        status: urgent([tab.status, ...nodes.map(n => n.status)]),
        actions: activation(space.id, tab.id, single?.pane) };
    });
    return { ...space, tabs, agentCount: tabs.reduce((n, t) => n + t.agentCount, 0),
      draftCount: tabs.reduce((n, t) => n + t.draftCount, 0),
      paneCount: tabs.reduce((n, t) => n + t.leaves.length, 0),
      status: urgent([space.status, ...tabs.map(t => t.status)]) };
  });
}

export function agentOrder(tree) {
  return tree.flatMap(s => s.tabs.flatMap(t => flatten(t.leaves)))
    .filter(p => p.agent && p.terminal).map(p => p.terminal);
}
