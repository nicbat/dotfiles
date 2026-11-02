#!/usr/bin/env python3
"""Record Codex lifecycle hooks for Herdr; emit OSC 7501 when a tty exists.

No hook decisions or stdout: this observer cannot approve or block anything.
The old Herdr SessionStart hook remains separate and unchanged.
"""
import json
import fcntl
import os
from pathlib import Path
import re
import sys
import time


def report(payload, env):
    if not isinstance(payload, dict):
        return None
    # Subagent hooks must never change the parent terminal's state.
    if payload.get("agent_id") or payload.get("subagent_id") or payload.get("source") == "fork":
        return None
    thread = env.get("CODEX_THREAD_ID")
    session = payload.get("session_id")
    if thread and session and thread != session:
        return None
    event = payload.get("hook_event_name")
    if event == "SessionStart":
        # A compaction is still inside the current turn.
        state = "working" if payload.get("source") == "compact" else "idle"
    elif event in {"UserPromptSubmit", "PreModelRequest", "PreToolUse", "PostToolUse", "PreCompact", "PostCompact"}:
        state = "working"
    elif event == "PermissionRequest":
        return b"\x1b]7501;state=blocked:app=codex:kind=permission\x1b\\"
    elif event == "Stop":
        state = "done"
    elif event == "Interrupt":
        state = "idle"
    else:
        return None
    if event == "PreToolUse" and payload.get("tool_name") == "request_user_input":
        return b"\x1b]7501;state=blocked:app=codex:kind=question\x1b\\"
    return f"\x1b]7501;state={state}:app=codex\x1b\\".encode("ascii")


def diagnostic(payload, message, tty_error):
    if not isinstance(payload, dict):
        return
    session = payload.get("session_id", "")
    if not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session):
        session = f"unknown-{os.getpid()}"
    folder = Path.home() / ".local/state/herdr-native-status"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / f".{session}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = folder / f"{session}.json"
        try:
            previous = json.loads(path.read_text())
        except (OSError, ValueError):
            previous = {}
        record = snapshot(payload, message, tty_error, previous, int(time.time() * 1000))
        temporary = folder / f".{session}.{os.getpid()}.tmp"
        temporary.write_text(json.dumps(record) + "\n")
        temporary.replace(path)


def snapshot(payload, message, tty_error, previous, now):
    if message is None and previous:
        return previous
    event = payload.get("hook_event_name")
    turn = payload.get("turn_id")
    # A background command completing must not restart a finished turn or an
    # earlier turn while a new one runs.
    if event == "PostToolUse" and turn and previous.get("turn_id"):
        if turn != previous["turn_id"] or previous.get("event") in {"Stop", "Interrupt"}:
            return previous
    state = re.search(rb"state=([a-z]+)", message).group(1).decode() if message else None
    return {"session_id": payload.get("session_id"), "event": event, "state": state,
            "turn_id": turn, "cwd": payload.get("cwd"), "observed_ms": now,
            "session_started_ms": now if event == "SessionStart" and payload.get("source") in {"startup", "resume"}
                else previous.get("session_started_ms"),
            "tty_error": tty_error, "ignored": message is None,
            "terminal": os.environ.get("HC_TERMINAL_ID")}


def main():
    try:
        payload = json.load(sys.stdin)
        message = report(payload, os.environ)
        if message is None:
            diagnostic(payload, message, None)
            return
        # Hook stdout is captured by Codex. Declawd hooks may have no controlling
        # tty; the sidebar then reads the same actual lifecycle state from disk.
        tty_error = None
        try:
            fd = os.open("/dev/tty", os.O_WRONLY | os.O_NOCTTY)
            try:
                os.write(fd, message)
            finally:
                os.close(fd)
        except OSError as error:
            tty_error = {"errno": error.errno, "message": error.strerror}
        diagnostic(payload, message, tty_error)
    except (OSError, ValueError, TypeError):
        # No terminal, malformed input, or unavailable output leaves status
        # unavailable; never invent a successful report or interrupt the agent.
        return


if __name__ == "__main__":
    main()
