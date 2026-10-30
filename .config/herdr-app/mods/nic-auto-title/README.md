# Native Auto Title

Personal copy of Herdr App 0.1.9's tab bar, used by `layouts/nic-main.json`.
The original shipped layout and tab bar remain managed by Herdr.

Automatic tab names follow the focused terminal's live title, with the
non-default branch or program name as fallbacks. Codex and Claude session titles are used
when the agent publishes them to its terminal. No transcript scanning, model
calls, background daemon, or redraw timer is involved.

Names show only the task, without tab numbers or space-name prefixes. Status
decorations and repeated folder suffixes are removed. A manual tab rename stops automatic updates for
that tab; clearing the name enables them again. Ownership is stored in this
mod's local storage, so reloads and app restarts retain that distinction.

Run `npm test` in this folder for the title and ownership tests, then run
`herdr-app check ~/.config/herdr-app/mods/nic-auto-title` for native validation.
