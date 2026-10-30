// Event-driven tab titles. Ownership survives hot reload; manual names always win.
export function cleanTitle(value, user = "") {
  let title = String(value ?? "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^[^\p{L}\p{N}~/\\]+/u, "")
    .trim();
  const suffix = user ? ` | ${user}` : "";
  if (suffix && title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
  return title.replace(/^(?:Action Required|Working|Done|Idle)\s+\|\s+/i, "").replace(/\s+/g, " ");
}

const basename = (path) => String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
const shorten = (value, limit = 76) => {
  const chars = Array.from(value);
  return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : value;
};

export function titleFor(tab, pane, home) {
  const cwd = pane.cwd ?? "";
  const context = cwd === home ? "" : basename(cwd);
  let task = cleanTitle(cleanTitle(pane.title, basename(home)), context);
  const generic = new Set(["codex", "claude", "claude code", "pi", "bash", "zsh", "fish", "shell", "terminal", "powershell", "pwsh"]);
  if (pane.program?.shell || generic.has(task.toLowerCase()) ||
      task.toLowerCase() === (pane.program?.name ?? "").toLowerCase() ||
      task === cwd || task === "~" || (!pane.program?.agent && task.includes("@")) || /^[~/\\]|^[A-Za-z]:[\\/]/.test(task)) task = "";
  const branch = pane.branch && !["main", "master", "trunk"].includes(pane.branch) ? pane.branch : "";
  return shorten(task || branch || (pane.program?.shell ? "Shell" : pane.program?.name) || "Terminal");
}

export class AutoTitles {
  constructor(storage, rename, home) {
    this.storage = storage;
    this.rename = rename;
    this.home = home;
    this.leads = {};
    try { this.owned = JSON.parse(storage.getItem("auto-title.owned") ?? "{}"); }
    catch { this.owned = {}; }
    if (!this.owned || typeof this.owned !== "object" || Array.isArray(this.owned)) this.owned = {};
  }

  sync(spaces, panes) {
    let dirty = false;
    for (const space of spaces) for (const tab of space.tabs) {
      const record = this.owned[tab.id];
      // A not-yet-named tab can also be the old snapshot of a pending rename.
      if (record?.pending && tab.name === record.previous && tab.name !== record.name) continue;
      if (record && tab.named && tab.name !== record.name) {
        // The previous snapshot may remain visible until our own rename lands.
        if (record.pending && tab.name === record.previous) continue;
        delete this.owned[tab.id];
        dirty = true;
      }
      if (tab.named && !this.owned[tab.id]) continue;
      const candidates = panes.filter((p) => p.tab === tab.id && p.terminal);
      const selected = candidates.find((p) => p.focused);
      if (selected) this.leads[tab.id] = selected.pane;
      const lead = selected ?? candidates.find((p) => p.pane === this.leads[tab.id]) ??
        candidates.find((p) => p.program?.agent && p.status === "working") ??
        candidates.find((p) => p.program?.agent) ?? candidates[0];
      if (!lead) continue; // Mod-only tabs keep their own titles.
      if (this.owned[tab.id]?.pending) {
        this.owned[tab.id].pending = false;
        dirty = true;
      }
      const name = titleFor(tab, lead, this.home);
      if (tab.name === name) continue;
      this.owned[tab.id] = { name, previous: tab.name, pending: true };
      // Persist before dispatch so a reload cannot mistake our rename for a manual one.
      this.storage.setItem("auto-title.owned", JSON.stringify(this.owned));
      this.rename(tab.id, name);
      dirty = true;
    }
    if (dirty) this.storage.setItem("auto-title.owned", JSON.stringify(this.owned));
  }
}
