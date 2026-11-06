function hasNode(node, id) {
  return node?.id === id || (node?.children ?? []).some(child => hasNode(child, id));
}

// Welcome preferences predate personal panels; keep their Files/Changes choices.
export function panelChoices(root, configured) {
  const enabled = Array.isArray(configured) ? [...configured] : ["files", "changes"];
  if (hasNode(root, "prs") && !enabled.includes("prs")) enabled.push("prs");
  return enabled;
}
