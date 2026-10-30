// A tab's title follows its selected pane; an agent row identifies one terminal.
export function agentLabel(agent, tab, panes, home) {
  const mine = panes.find(p => p.terminal === agent.address || p.pane === agent.pane);
  const split = panes.filter(p => p.tab === agent.tab && p.terminal).length > 1;
  const program = agent.program?.name ?? mine?.program?.name ?? "Agent";
  if (!split && tab?.name && !/^\d+$/.test(tab.name) && tab.name.toLowerCase() !== program.toLowerCase()) {
    return tab.name; // Keep a single-agent tab's chosen name.
  }
  let title = String(agent.title || mine?.title || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^[^\p{L}\p{N}~/\\]+/u, "")
    .replace(/^(?:Action Required|Working|Done|Idle)\s+\|\s+/i, "")
    .trim();
  // Codex's terminal title ends in its folder; the task itself may contain pipes.
  if (agent.app === "codex" || agent.program?.key === "codex") {
    title = title.replace(/\s+\|\s+[^|]+$/, "");
  } else {
    const basename = path => String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    for (const suffix of [basename(home), basename(mine?.cwd), agent.space_name]) {
      if (suffix && title.endsWith(` | ${suffix}`)) title = title.slice(0, -(suffix.length + 3)).trim();
    }
  }
  if (title && !/^\d+$/.test(title) && title.toLowerCase() !== program.toLowerCase() &&
      title.toLowerCase() !== (agent.program?.key ?? "") && !/^[~/\\]|^[A-Za-z]:[\\/]/.test(title)) return title;
  return split ? `${program} · ${agent.address}` : program;
}
