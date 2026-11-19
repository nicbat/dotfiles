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
  // `label(terminal, name)` names one pane (nic-menu's Rename); `names` passed to sync
  // maps terminals to those names.
  constructor(storage, rename, home, label = () => {}) {
    this.storage = storage;
    this.rename = rename;
    this.label = label;
    this.home = home;
    this.clearing = {};
    this.owned = this.load("auto-title.owned");
    // The last pane and name of each one-pane tab, to hand that name to the pane when it becomes a group.
    this.singles = this.load("auto-title.singles");
  }

  load(key) {
    try {
      const value = JSON.parse(this.storage.getItem(key) ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }

  sync(spaces, panes, names = {}) {
    let dirty = false, singlesDirty = false;
    for (const space of spaces) for (const tab of space.tabs) {
      const leaves = panes.filter((p) => p.tab === tab.id);
      const candidates = leaves.filter((p) => p.terminal);
      // Our own clearing may not have landed in this snapshot yet.
      if (this.clearing[tab.id] !== undefined) {
        if (tab.named && tab.name === this.clearing[tab.id]) continue;
        delete this.clearing[tab.id];
      }
      if (leaves.length > 1) {
        // A group is numbered until it's renamed. A one-pane tab that became one gives its
        // name to its pane: a chosen name moves to the pane, an automatic one just clears.
        const single = this.singles[tab.id];
        if (single) { delete this.singles[tab.id]; singlesDirty = true; }
        const record = this.owned[tab.id];
        const automatic = record && (tab.name === record.name || (record.pending && tab.name === record.previous));
        const inherited = single && tab.named && tab.name === single.name;
        if (inherited && !automatic && leaves.some((p) => p.terminal === single.terminal)) this.label(single.terminal, tab.name);
        if (record) { delete this.owned[tab.id]; dirty = true; }
        if (tab.named && (automatic || inherited)) {
          this.clearing[tab.id] = tab.name;
          this.rename(tab.id, "");
        }
        continue;
      }
      if (candidates.length === 1 && tab.named &&
          (this.singles[tab.id]?.terminal !== candidates[0].terminal || this.singles[tab.id]?.name !== tab.name)) {
        this.singles[tab.id] = { terminal: candidates[0].terminal, name: tab.name };
        singlesDirty = true;
      }
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
      const lead = candidates[0];
      if (!lead) continue; // Mod-only tabs keep their own titles.
      if (this.owned[tab.id]?.pending) {
        this.owned[tab.id].pending = false;
        dirty = true;
      }
      // A pane named in a group keeps that name as its own tab's.
      const name = names[lead.terminal] || titleFor(tab, lead, this.home);
      if (tab.name === name) continue;
      this.owned[tab.id] = { name, previous: tab.name, pending: true };
      // Persist before dispatch so a reload cannot mistake our rename for a manual one.
      this.storage.setItem("auto-title.owned", JSON.stringify(this.owned));
      this.rename(tab.id, name);
      dirty = true;
    }
    if (dirty) this.storage.setItem("auto-title.owned", JSON.stringify(this.owned));
    if (singlesDirty) this.storage.setItem("auto-title.singles", JSON.stringify(this.singles));
  }
}
