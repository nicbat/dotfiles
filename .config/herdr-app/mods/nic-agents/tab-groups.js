// Keep split-tab agents together, preserving the first appearance of each tab.
// Called within a space/priority/pinned section so those boundaries stay intact.
export function tabGroups(agents) {
  const groups = new Map();
  for (const agent of agents) {
    const key = agent.tab ?? agent.address;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(agent);
  }
  return [...groups.values()];
}
