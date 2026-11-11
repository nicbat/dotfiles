// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, home, notify } from "herdr";
import { moveSource, unmergeSource } from "./move-targets.js";
import { movePicker } from "./move-view.js";
import { menuPanel, menuItem, menuRule } from "./menu-ui.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// What to paste when asking one agent to reach another: its address, where it
// is now (space / tab), and its live folder. Moving a pane keeps the address.
function reference(term, pane) {
  const space = spaces().find((s) => s.tabs?.some((c) => c.id === pane?.tab));
  const tab = space?.tabs.find((c) => c.id === pane?.tab);
  const where = space && tab ? `${space.name} / ${tab.name}` : term.where;
  const folder = (pane?.cwd || term.foreground?.cwd || term.cwd || "").replace(home(), "~");
  return [`Herdr agent ${term.address} (hc address)`, where && `— ${where}`, folder && `(${folder})`].filter(Boolean).join(" ");
}

// Agents whose transcripts herdr-agent.py can read.
const SHAREABLE = new Set(["claude-code", "codex", "pi"]);

function agentItems(term, pane) {
  return [
    [`Copy address (${term.address})`, "copy", { text: term.address }],
    ["Copy agent reference", "copy", { text: reference(term, pane) }],
    ...(SHAREABLE.has(term.agent) ? [["Share last response", "share-last", { terminal: term.address }]] : []),
  ];
}

// A tab of one terminal stands for it in the lists, so its menu offers the same.
function tabAgentItems(tab) {
  const leaves = panes().filter((x) => x.tab === tab);
  const term = leaves.length === 1 && terminals().find((t) => t.address === leaves[0].terminal);
  return term ? agentItems(term, leaves[0]) : [];
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  const source = moveSource(p, panes(), terminals());
  const move = source && !source.terminal.includes("/") ? [["Move to tab…", "move-to-tab", { tab: p.tab, target: tg }]] : [];
  const separate = unmergeSource(p, spaces(), panes(), terminals());
  const unmerge = separate ? [[p.tab === "pane" ? "Move to own tab" : "Unmerge panes", "unmerge-tab", separate]] : [];
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...move,
        ...unmerge,
        ...(term
          ? [
              ...agentItems(term, panes().find((x) => x.pane === tg.pane)),
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ...move,
        ...unmerge,
        ...tabAgentItems(tg.id),
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

const ICONS = { "worktree": "git-branch", "app.help": "terminal", "app.theme": "settings", "pane.split": "panel-right",
  "pane.zoom": "square", "move-to-tab": "layers", "unmerge-tab": "panel-left", "copy": "files", "share-last": "file-text",
  "terminal.right_click": "monitor", "terminal.park": "pin-off" };
function menuIcon(command) {
  return command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" :
    ICONS[command] ?? "terminal";
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    // Herdr opens the terminal right-click menu itself, framed (mod.json's frame isn't used there).
    // Reopen it frameless at the pointer so it draws like every other menu.
    const opened = props();
    if (!opened?.frameless && !opened?.movePicker) {
      const { overlay, ...rest } = opened ?? {};
      this.reopening = true;
      if (overlay) closeOverlay(overlay);
      openOverlay({ mod: "nic-menu", kind: "popup", frame: "none", width: 228, height: 330, props: { ...rest, frameless: true } });
      return;
    }
    this.at = 0;
    this.destination = null;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    if (this.unmerging) return;
    const it = items(props(), this.git)[i];
    if (!it) return;
    if (it[1] === "unmerge-tab") {
      this.unmerging = true; cx.notify();
      const overlay = props()?.overlay;
      cx.spawn(async cx => {
        try {
          const args = [`${home()}/.local/bin/herdr-unmerge-tab.py`, it[2].tab];
          if (it[2].terminal) args.push(it[2].terminal);
          const reply = await exec("python3", args);
          const result = JSON.parse(reply.stdout);
          if (!result.ok) throw new Error(`${result.moved?.length ? `${result.moved.length} panes separated. ` : ""}${result.error}${result.recovered ? " The interrupted pane is in its own tab." : ""}`);
          closeOverlay(overlay);
        } catch (error) { notify({ title: "Could not finish unmerge", body: String(error.message ?? error), level: "error" }); }
        finally { this.unmerging = false; cx.notify(); }
      });
      return;
    }
    if (it[1] === "share-last") {
      closeOverlay(props()?.overlay);
      cx.spawn(async (cx) => {
        try {
          const reply = await exec("python3", [`${home()}/.local/bin/herdr-agent.py`, "last", it[2].terminal, "--write", "--json"]);
          if (reply.code !== 0) throw new Error(reply.stderr.replace(/^herdr-agent: /, "").trim() || "No response found");
          const result = JSON.parse(reply.stdout);
          cx.write_to_clipboard(result.line);
          const notes = [!result.verified && "not seen on its screen, check it", result.earlier_turn && "its previous turn; it's working"].filter(Boolean);
          notify({ title: "Copied last response", body: result.line + (notes.length ? ` (${notes.join("; ")})` : ""), level: result.verified ? "info" : "warning" });
        } catch (error) { notify({ title: "Could not share last response", body: String(error.message ?? error), level: "error" }); }
      });
      return;
    }
    closeOverlay(props()?.overlay);
    if (it[1] === "copy") { cx.write_to_clipboard(it[2].text); notify({ title: "Copied", body: it[2].text }); }
    else if (it[1] === "move-to-tab") openOverlay({ mod: "nic-menu", kind: "dialog", width: 620, height: 480, props: { ...it[2], movePicker: true } });
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    if (props()?.movePicker) return movePicker(this);
    if (this.reopening) return div();
    const t = theme();
    const list = items(props(), this.git);
    const rule = (it, i) => i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme"));
    // The overlay is frameless and a little taller than any menu; the panel is as tall as its rows,
    // and a press beside it closes the menu.
    return div()
      .id("menu-root")
      .size_full()
      .track_focus(this.handle)
      .on_mouse_down("left", () => closeOverlay(props()?.overlay))
      .on_key_down((e, cx) => {
        if (this.unmerging) { cx.stop_propagation(); return; }
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(menuPanel("menu", t, 220).children(
        this.unmerging ? [div().px(7).py(6).text_color(t.muted).child("Separating panes…")] : list.flatMap((it, i) => [
          ...(rule(it, i) ? [menuRule(t)] : []),
          menuItem(`mi-${i}`, { label: it[0], icon: menuIcon(it[1]), hint: shortcut(it[1], it[2]), active: i === this.at },
            cx => this.choose(i, cx), t),
        ]),
      ));
  }
}
