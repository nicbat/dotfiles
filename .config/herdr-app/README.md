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
- `mods/nic-workspace-status`: counts the same recognized
  agents as the sidebar, including live legacy attachments and declawd
  wrappers without native status reports. In `nic-combined`, it supplies
  `working/total agents` to the Workspaces section header; the bottom bar keeps
  machine, branch and palette controls. Other layouts retain the bottom counter.
  Counts use native reports, fresh local attachment snapshots, and Codex hook
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

Select `nic-combined` for the personal Space → Tab → Pane sidebar, now above a
shared personal **Todo** section. Click either section's header to collapse its
body; drag the divider between them to resize. Each body scrolls independently;
its scrollbar uses a narrow 8px rail and fades out over 150ms after 300ms idle.
The rail stays visible while hovered and is omitted when the content fits.
Native scrolling and thumb dragging are retained; todo +/×/check actions share
the same right-hand column.
Workspace rows use the same right inset and a fixed 22px status column. Space
counts and hover + controls stay at the far right, with aggregate status beside
them; tab, pane and worker indicators share that edge. Idle rows reserve their
status space so adjacent badges stay put. Section-header + controls align too.
Expanded Spaces leave selection highlighting to their tabs; a Space keeps its
own highlight when collapsed or shown in the narrow rail.
Collapsed sections keep their header and count; reopening restores the previous
height within the available window space. Section sizes and collapse state are
saved by Herdr. The original sidebar node ID is retained for workspace storage.
The Workspaces header shows working/total agents and a status dot: blocked when
an agent needs attention, working while agents work, otherwise dim. Its tooltip
includes working, total, needs-attention and unavailable counts. There is no
duplicate agent counter at the bottom of this layout.

Type in **Add a todo…** and press Enter (or +). Check an item to complete it;
completed items stay muted below open ones and can be reopened. Click a title
to edit; a checkmark replaces the row's × while editing. Enter/check saves and
Escape cancels. The row's ×
deletes it, with **Undo** for the latest deletion. The header counts open items.
One list follows you across Spaces, and unfinished add text survives reloads.
No agent changes the list automatically.

`mods/nic-todo` uses local storage for entries and add text. Herdr stores it under
`data/nic-todo/`; it is personal data, excluded from dotfiles backup, not synced
between computers. Malformed or unknown-version saved entries are kept intact
and editing is disabled until the data is repaired. Undo is available until the
next deletion or mod/app reload. The narrow sidebar rail retains the section
chevrons but hides todo entry and rows; widen it to edit the list.

`mods/nic-sidebar-section` provides reusable section headers. Each is a column
with a fixed 30px header and a body block; their parent column owns native
dividers. Header props name the section, body, parent, title and optional count
and add action. An optional `activity` prop reads the shared agent summary from
`nic.sidebar.agent-counts`; the footer publishes only when counts change.
Body mods publish their full section height for size restoration.
Use `herdr-app do nic-sidebar-section.toggle-todo-section` or
`toggle-workspace-section` to toggle the corresponding section without pointer
input. New sections can reuse this mod; keep the `<section>-header` ID convention.
Validate its and the todo's `*.test.mjs` suites alongside the workspace suite,
then native-check all three mods and view a screenshot. `nic-main` is unchanged.

All tabs
remain listed, including shells, editors, settled tabs, and mod/document panes.
Single-pane tabs use one row; split tabs show a pane count and expand with the
chevron. Expanded panes sit in an indented group with a vertical guide, with
aligned icons for agent, shell, and document panes. Clicking a pane focuses
that exact pane; clicking a split tab keeps
its existing pane selection. Space and tab order stay stable as activity changes.
Space chevrons fold their tabs while keeping agent counts and attention badges.
Hovering a space replaces its agent count with a + button. Click + to open a
new shell tab in that space; clicking elsewhere on the row selects the space.
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
include the Codex hook reader. The shared counter uses the raw working status,
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

### Drag tabs and panes

The personal top tab bar and `nic-combined` sidebar share drag handling:

- Drag a tab to the left/right quarter of another top-bar tab to reorder it.
  In the sidebar, use the top/bottom quarter of a tab row. An accent insertion
  line marks the position. Ordering stays within the source space and is saved
  by the App's normal `tab.move` command; split and document tabs reorder intact.
- Drop a single-terminal tab on the center of another tab to make a right split.
  Hold Shift to split below. The target keeps its title, with an outline and a
  small icon showing side-by-side or stacked panes before release.
  A tab destination uses its selected terminal pane, or its
  first terminal pane; a pane-row destination is exact.
- For an existing split source, expand it in the combined sidebar and drag the
  individual pane row to another tab or pane. A whole split tab only reorders,
  as requested. The top bar and sidebar accept drops from each other.

Only the surface under the pointer draws the insertion marker, and only when
the order would change. The top scroll rail hides while dragging. Split previews
keep the destination title visible, with an outline and an opaque direction
badge instead of a text overlay; Shift changes the icon to stacked panes.
Unavailable targets show no warning cursor or overlay; releasing there does
nothing. After a menu or drag merge,
the combined sidebar expands the destination group automatically; a later
manual collapse stays collapsed until the next merge.

To undo a split, right-click its tab row and choose **Unmerge panes**. The first
pane keeps the original tab; each other terminal gets its own tab in the same
space. Or right-click a particular pane and choose **Move to own tab**. No
process is relaunched. Whole-group unmerge requires live local terminal panes;
mixed document groups offer individual terminal moves. A failure stops the
remaining moves and reports any panes already separated.

Before a move, the helper remembers the pane's tab name in a process-bound
`nic.tab-title` core label. Giving it its own tab restores that name, including
after repeated merges, unmerges and recovery. Renaming a separate tab updates
the remembered name on its next move. Named split groups keep their group name
when another pane is merged or focused; pane titles remain independent. Names
are live core metadata, not a tracked session backup. Older groups without a
remembered name use their current group name; an address-only tab can recover
its task from the terminal's title when available.

Move at least six pixels to start a drag. Escape or a release on blank space
cancels without moving a terminal. A new press clears any abandoned gesture;
gestures expire after 30 seconds. Remote and document-only split destinations
remain excluded. The native pane grip still rearranges within its current tab.
There is no automatic tab switching or edge scrolling during a drag; use the
sidebar for another workspace or a destination outside the visible tab bar.

`drag-model.js` and `drag-ui.js` are copied identically in `nic-auto-title` and
`nic-workspaces`, because imports are mod-scoped. The move helper also checks
the captured pane/tab/process identity before parking; a changed source or
destination fails without a move. Existing Draft badges, activity, titles,
menus and completion tracking stay separate. Validate the Node drag-model and
real-handler fixture suites and Python move tests alongside the existing suites.
`.local/bin/herdr-unmerge-tab.py` shares the move helper's lock and uses its
guarded own-tab placement. Include that helper and `test_herdr_unmerge_tab.py`
when restoring; the on-demand backup path list includes both.

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

## Background shells and Codex startup

Both personal sidebars show an inline amber terminal icon and count beside
agents whose live Codex or Claude footer reports background shells. Hover for
the full label; click the agent row to view its own shell controls. Collapsed splits and folded
workspaces in `nic-combined` retain totals; `N+` means another supported agent's
count is unavailable. Shells never increase the agent count or change lifecycle
status, draft hints or completion acknowledgment.

The existing `herdr-draft-status.py` observer now also reads bounded footer counts
in the same screen observation. Counts expire after eight seconds, reject changed
terminal/foreground identities, and clear on failed reads. Wrapped native footers
are supported; custom status lines, transcript mentions and text in a composer
are excluded. A hidden/clipped Claude count remains unknown; Pi's stock shell
inventory is unsupported. No additional daemon, hook, input or history read is used.

Codex startup binding allows up to 90 seconds between observing the foreground
process and its SessionStart, with a two-minute record-arrival window. Stored
startup observations survive sidebar reloads, renew when the process changes and
are pruned when it disappears. Binding still requires a mutually unique session,
folder and time match; native reports win and ambiguous matches stay unavailable.
Older unbound sessions need an explicitly verified session/PID binding. This fixes
the short startup window that missed slow wrapped launches; it does not fabricate
native OSC reports or restart existing sessions.
