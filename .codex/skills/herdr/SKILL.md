---
name: herdr
description: "Work with Herdr App and herdr-core (hc): customize the window, layouts, keys and mods, or manage its terminals and agents. Use when the user explicitly mentions Herdr or requests work in their Herdr environment. Do not select it merely because an unrelated task could benefit from background terminals or delegation."
---

# Herdr App and herdr-core

Default to the native Herdr App. The older `herdr` TUI is a separate runtime;
its commands, plugins, environment variables and IDs do not control the app.

## Read the installed instructions

At the start of a Herdr task, read the relevant built-in manual. Its current
output is the authority; reuse it within the task rather than keeping copied
CLI documentation in this skill.

- **Window, spaces, tabs, panes, focus and screenshots:** run
  `herdr-app --skill`. Inspect `herdr-app ls` and `herdr-app status` before
  changing the window. Use `herdr-app commands` for exact command arguments.
- **Running, reading, messaging or waiting on programs and agents:** run
  `hc --skill`. Use `hc` for orchestration, including background work that
  should not change the visible layout. Consult the relevant command's
  `--help` when needed. Follow the session's delegation authorization.
- **Keys, settings, layouts or mods:** also read
  `${HERDR_APP_HOME:-$HOME/.config/herdr-app}/AGENTS.md` and the relevant
  generated `.d.ts` definitions beside it. Do not edit generated guidance.

If a binary is unavailable, report which capability is missing; do not
silently substitute the legacy TUI. If the user explicitly requests legacy
TUI work, inspect `herdr --help` and that runtime's context first.

## Keep the runtimes and targets straight

`$HC_TERMINAL_ID` is the calling terminal's core address, not an app pane ID.
Use IDs returned by the app for window commands and core terminal addresses
for `hc`. There is no `HERDR_ENV=1` prerequisite for the app/core workflow.
Do not assume the person is looking at the calling agent's pane: discover
and pass the intended target explicitly.

Use app commands when the person wants a visible tab or split. Keep background
workers hidden unless they ask to see them; follow the installed manuals for
labels, remote machines, readiness and collecting results. A launch response
alone does not establish that a program started or its task was submitted.

When launching Codex through Herdr, include `--no-daemon`, including in core
templates. A shared Codex server can retain another terminal's environment and
attribute children to the wrong parent. Existing daemon-backed sessions need
to be resumed without the daemon before their tool context changes; do not
restart someone else's active session automatically.

## Visible panes and tabs

Creating a visible tab or split is supported by Herdr App. Read its manual,
then inspect `herdr-app ls` for the intended space and pane IDs. For example:

```sh
herdr-app do pane.split --pane <existing-pane-id> --direction right
herdr-app do tab.new --space <existing-space-id> --name "review" --folder /path/to/repo
```

Use the IDs in the command response and confirm the result with `ls`.
These commands change the visible window; creating a pane does not authorize
starting an agent. Do not add an `argv` or task unless that launch is authorized.
There is no app equivalent implied by an old TUI command or its flags; check
`herdr-app commands` rather than transferring syntax between runtimes.

On this managed Mac, `codex`, `claude`, `pi` and model aliases may invoke
`declawd`. Inspect their wrapper definitions without executing them for
CLI discovery. Never invoke declawd or its wrappers in the calling agent's
own tool process tree, including help/version commands. Follow the session's
personal launch policy when starting one in a new destination. Any stricter
caller-context, new-pane, readiness or focus requirements in that policy
still apply; report a blocked launch instead of treating this skill as an
exception. Use the requested shell alias/model rather than guessing it.

## Preserve the person's workspace

Do not launch bare `herdr-app` for inspection: it opens or raises the window.
Do not stop or restart the app/core, close existing work, or replace remote
sessions without an explicit request. Do not automate pointer or key input on
the person's real display. For a blocked agent, read what it needs and obtain
any required user decision rather than bypassing the prompt.

Edit personal layouts and mods. Clone shipped ones with the app's clone
commands before modifying them, and inspect current layout references to find
the person's existing customizations. After a mod change, run
`herdr-app check <mod-folder>`, inspect `herdr-app status`, then capture and
view `herdr-app shot <path.png>`. Hot reload retaining an old version is not
proof a change passed.
