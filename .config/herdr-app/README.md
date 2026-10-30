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

## Restore

Install Herdr App, herdr-core and Noctalia, then restore the dotfiles with
yadm. Launch Herdr so its shipped mods and generated types are installed,
select the `nic-main` layout, and choose “Grouped by space” in the Agents
sort menu. Select a Noctalia palette/wallpaper to regenerate its Herdr theme.
The local Noctalia plugin overrides the community copy with the same ID.
Running agents and sessions are managed by herdr-core separately from this
source backup.

## Validate after editing

Run `herdr-app check ~/.config/herdr-app/mods/<name>` for each changed mod,
then inspect `herdr-app status` and `herdr-app shot /tmp/herdr.png`.
Node tests live beside the sidebar and auto-title sources. Noctalia's plugin
has Lua and Python tests under its `tests/` directory.
