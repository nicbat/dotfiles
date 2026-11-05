export const HEADER_HEIGHT = 30;

export function find(node, id) {
  if (!id) return null;
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Collapse only the body, keeping its live mod and the header in the layout.
// Expanded peers share the freed space; reopening restores the previous height
// within the space currently available, including after a window resize.
export function toggleSection(root, options, measured, savedHeight) {
  const { section, body, parent } = options;
  const siblings = find(root, parent)?.children ?? [];
  const node = siblings.find(n => n.id === section);
  if (!node || !find(node, body)) return null;
  const collapsed = find(node, body).hidden === true;
  const height = n => {
    if (n.children?.find(c => c.id !== `${n.id}-header`)?.hidden) return HEADER_HEIGHT;
    const value = measured(n.id);
    return Number.isFinite(value) && value > HEADER_HEIGHT ? value : (n.size?.px ?? 240);
  };
  const peers = siblings.filter(n => n.id !== section && !n.children?.find(c => c.id !== `${n.id}-header`)?.hidden);
  const commands = [];
  if (!collapsed) {
    const expandedHeight = height(node);
    commands.push(["layout.hide", { id: body }], ["layout.resize", { id: section, px: HEADER_HEIGHT }]);
    for (const peer of peers) commands.push(["layout.resize", { id: peer.id, weight: height(peer) }]);
    return { expandedHeight, commands };
  }
  commands.push(["layout.show", { id: body }]);
  if (!peers.length) {
    commands.push(["layout.resize", { id: section, weight: 1 }]);
  } else {
    const peerHeight = peers.reduce((sum, peer) => sum + height(peer), 0);
    const available = peerHeight + HEADER_HEIGHT;
    const wanted = Number.isFinite(savedHeight) && savedHeight > HEADER_HEIGHT ? savedHeight : 240;
    const restored = Math.max(HEADER_HEIGHT, Math.min(wanted, available - peers.length * HEADER_HEIGHT));
    commands.push(["layout.resize", { id: section, weight: restored }]);
    for (const peer of peers) commands.push(["layout.resize", {
      id: peer.id, weight: height(peer) / peerHeight * (available - restored)
    }]);
  }
  return { commands };
}
