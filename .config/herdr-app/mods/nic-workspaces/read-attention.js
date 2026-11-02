import { urgent } from "./workspace-tree.js";

const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);

// This is a presentation layer. Keep the source lifecycle state as reportedStatus;
// only the unread completion indicator changes when the person views a terminal.
export function readAttention(tree, seen = {}, focus = null, active = false) {
  const next = { ...seen };
  let changed = false;
  const decorate = node => {
    const raw = node.reportedStatus ?? node.status;
    const address = node.terminal;
    const key = node.completion_key ?? JSON.stringify(["native", address, node.seq ?? "unversioned"]);
    if (node.agent && address) {
      // Without a completion version, an observed working -> done cycle is the
      // best available boundary. Unknown/failed snapshots must retain read state.
      if (raw === "working" && next[address] !== undefined) {
        delete next[address];
        changed = true;
      }
      if (raw === "done" && active && focus?.terminal === address && next[address] !== key) {
        next[address] = key;
        changed = true;
      }
    }
    return { ...node, reportedStatus: raw,
      status: node.agent && raw === "done" && next[address] === key ? "idle" : raw,
      children: (node.children ?? []).map(decorate) };
  };
  const result = tree.map(space => {
    const tabs = space.tabs.map(tab => {
      const leaves = tab.leaves.map(decorate);
      const agents = flatten(leaves).filter(n => n.agent);
      return { ...tab, leaves, single: leaves.length === 1 ? leaves[0] : null,
        // Raw native summaries must not restore a dot after its leaf was read.
        status: agents.length ? urgent(agents.map(a => a.status)) : tab.status };
    });
    return { ...space, tabs, status: urgent(tabs.map(t => t.status)) ?? space.status };
  });
  return { tree: result, seen: next, changed };
}
