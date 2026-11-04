# Personal Herdr setup

Sources are tracked by yadm in https://github.com/nicbat/dotfiles.

Run `herdr-backup --dry-run` to list pending Herdr changes, then
`herdr-backup` to commit and push them. An optional quoted argument supplies
the commit message. Backups run on demand; no scheduled job is installed.
The command includes the Herdr-specific paths below and preserves unrelated
staged and unstaged dotfile changes.

## Maintained sources

- `keys.json`, `settings.json`, `programs.json`, `layouts/nic-*.json`.
- `mods/nic-agents`: individual agent titles, active-row highlighting,
  hidden worker trees, and a connecting bracket for panes sharing a tab.
  “Grouped by space” keeps these tab groups inside their workspace;
  priority sections and pins retain their boundaries.
  Recognized agents, including declawd wrappers, remain selectable without
  native status reports. Local attachments read fresh source-server activity;
  direct Codex agents read session/PID-bound lifecycle records. Missing reports
  show “Status unavailable.” Native reports take precedence; shell prompts and
  hidden background commands are excluded. Codex and Claude retain full-color
  logos; Pi uses a theme tint. Live legacy attachments must be labeled with
  `herdr.legacy.agent`, `herdr.legacy.pane`, and `herdr.legacy.title`; the
  foreground command must still be `herdr agent attach` for that pane.
  Attachments preserve the original running session and depend on its legacy
  server. Their labels do not provide native activity reporting.
- `.local/bin/herdr-native-status.py` and `.codex/hooks.json`: Codex lifecycle
  observer used by both sidebars and the footer. When restoring, merge these
  hook groups with existing hooks, preserving any legacy TUI SessionStart hook.
  Review/trust the observer through `/hooks` on each computer. It emits no hook
  decisions. Records in `~/.local/state/herdr-native-status` remain local and
  are never backed up; native OSC 7501 reports take precedence when available.
- `mods/nic-workspace-status`: the bottom bar counts the same recognized
  agents as the sidebar, including live legacy attachments and declawd
  wrappers without native status reports. It shows `working/total agents`,
  using native reports, fresh local attachment snapshots, and Codex hook
  records bound to the live session and foreground PID. Its “needs you” count
  uses reported blocked states; unavailable status stays distinct in the
  tooltip. Herdr scopes imports to each mod; keep its local `visible-agents.js`
  and `codex-status.js` copies synchronized with the combined sidebar.
- `mods/nic-auto-title`: tab titles from the active terminal's task.
- `mods/nic-which-key`: F1 and Ctrl+B Space keybinding guide.
- `~/.local/share/noctalia/plugins/herdr`: local App/TUI monitoring plugin,
  core fallback, animated status wheels, and tests.
- `~/.config/noctalia/templates/herdr-app.json` and `themes.toml`: theme
  source and registration. Noctalia regenerates the palette.
- `~/.codex/skills/herdr/SKILL.md`, the legacy Herdr config, and `.bashrc`
  (including the per-terminal Codex launcher).

The ignore rules exclude live terminals, sessions, mod storage, focus and
window state, generated palettes/types, backups, and Herdr's shipped UI.
New personal mods/layouts named `nic-*` are included by the backup command.

`mods/nic-menu` is a personal clone of the shipped menu. Both personal layouts
use it for terminal right-clicks; the combined sidebar, agent rows and personal
tab bar also open it. Restore the new Python helpers below alongside the mods.

## Restore

Install Herdr App and herdr-core, then restore the dotfiles with yadm. Launch
Herdr so its shipped mods and generated types are installed. Select
`nic-combined` for the combined sidebar, or `nic-main` and “Grouped by space”
in the Agents sort menu for the original view. Install Python 3 for the Codex
observer, merge/review its hooks as described above, and make sure each computer's
Codex launcher includes `--no-daemon`. Existing running sessions are not migrated
by pulling these source files. If using Noctalia, install it and select a
palette/wallpaper to regenerate its Herdr theme.
The local Noctalia plugin overrides the community copy with the same ID.
Running agents and sessions are managed by herdr-core separately from this
source backup.

## Validate after editing

Run `herdr-app check ~/.config/herdr-app/mods/<name>` for each changed mod,
then inspect `herdr-app status` and `herdr-app shot /tmp/herdr.png`.
Node tests live beside the sidebar and auto-title sources. Noctalia's plugin
has Lua and Python tests under its `tests/` directory.

## Combined workspace sidebar

Select `nic-combined` for the personal Space → Tab → Pane sidebar. All tabs
remain listed, including shells, editors, settled tabs, and mod/document panes.
Single-pane tabs use one row; split tabs show a pane count and expand with the
chevron. Expanded panes sit in an indented group with a vertical guide, with
aligned icons for agent, shell, and document panes. Clicking a pane focuses
that exact pane; clicking a split tab keeps
its existing pane selection. Space and tab order stay stable as activity changes.
Space chevrons fold their tabs while keeping agent counts and attention badges.
The top tab bar, pane headers, Files/Changes panel, and personal footer remain.

`mods/nic-workspaces` retains full-color program logos and the installed
sidebar's agent recognition. Local legacy attachments refresh source-server
status every three seconds; expired, missing, or failed reports remain unknown
(`?`). Non-agent tabs have no agent status. Hidden workers remain expandable;
ordinary background jobs do not count as agents. Remote legacy attachments
remain unknown instead of borrowing a local server's state.

The mod has local copies of `visible-agents.js` and `agent-title.js`, because
Herdr scopes module imports to each mod. The recognition and Codex status helpers
match `nic-agents`; the footer keeps its own copies too. The title helper also
treats a document pane as a split.

Validate with `node --test *.test.mjs` inside `mods/nic-workspaces`, then the
native check and screenshot commands above. Return to the previous sidebar:
`herdr-app do layout.switch --name nic-main`. Both layouts share the same live
sessions; switching layouts does not recreate them.

### Completion indicators

In `nic-combined`, a solid blue dot means an **unread completion**. Viewing the
actual agent terminal in the active Herdr window acknowledges that completion,
whether reached by a sidebar click, the top tab bar, keyboard navigation, or a
worker peek. Expanding a space or split tab alone acknowledges nothing. In a
split, viewing one pane leaves other panes' completions unread. Space/tab dots
clear when their remaining unread completions clear.

Read state persists in this mod's local storage. Legacy attachment completions
use their source completion sequence; Codex hooks use the bound session and
turn, with event time for older records. Repeated polls do not re-arm a dot;
a new completion does. States lacking a version can only detect a new completion
when a working cycle is observed. Unknown/missing snapshots retain read state.
The source lifecycle report is preserved; only its sidebar presentation changes.

Read/idle agents have no status glyph. Spinners remain Working, `!` remains
Needs you, and `?` remains Status unavailable. This applies to the combined
sidebar; `nic-main` retains its existing behavior. All personal status readers
include the Codex hook reader. The footer counts the raw working status,
independent of the sidebar's completion/read presentation.

## Move to tab

Right-click an agent's compact single-pane tab row, a pane inside an expanded
split tab, or its terminal body, then choose **Move to tab…**. Choose a destination
tab and **Move right** or **Move below**. In `nic-main`, right-click the agent row.
The original menu actions remain available. If a program owns right-clicks,
Shift+right-click still opens Herdr's menu.

The picker includes other tabs with live terminal panes on this computer, in
their existing workspace/tab order. It excludes the source tab, remote tabs
and document-only tabs. A split tab's top-level menu does not guess which pane
to move; use that pane's row or terminal. The terminal keeps its working
directory, process, conversation and task ownership.

`.local/bin/herdr-move-terminal.py` serializes menu moves, uses supported
park/focus/keep commands, waits for pending core changes and verifies that the
same program landed once in the chosen tab with core keep restored. A confirmed
parked terminal is kept in its own tab if the destination disappears or rejects
placement. An uncertain pending placement is not replayed; an error is shown.
The source tab disappears when its last pane is moved.

`herdr-app do nic-workspaces.move-to-tab` opens the same picker for the focused
pane in the combined layout. No automatic move or new agent launch occurs.

## Draft prompts

Both personal sidebars show an amber **Draft** badge when a recognized visible
Claude, Codex or stock Pi composer contains unsubmitted text. Drafts coexist
with native, attachment and hook status; they do not replace Working, Done or
Needs you, affect working/total counts, or acknowledge completions. Folded
spaces and collapsed split tabs retain aggregate draft hints.

`.local/bin/herdr-draft-status.py` reads only current styled screens using
`hc attach --observe --history 0`. It never types, resizes, scrolls through
history or changes agent status. It returns boolean observations bound to the
terminal/foreground identity, without saving or returning prompt text.
Sidebars refresh every three seconds and discard failed, replaced or expired
observations. Dim placeholders and recognized dialogs/history are excluded.
ANSI charset resets are control sequences, not composer text.

The detector is a bounded UI adapter. Alternate/custom editors or hidden
composer boundaries remain unrecognized; missing observations do not establish
an empty draft. Current live positive validation covers Claude; Codex empty
views and synthetic Codex/Pi drafts are tested. Keep the `draft-status.js`
copies in `nic-agents` and `nic-workspaces` synchronized.

Tests: Node suites beside the affected mods, and Python
`test_herdr_draft_status.py`, `test_herdr_move_terminal.py`, plus the existing
native-status observer tests under `.local/bin`. These helpers are included
in the on-demand backup's path list; no new service or hook is installed.
