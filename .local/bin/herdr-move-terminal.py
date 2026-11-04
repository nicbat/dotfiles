#!/usr/bin/env python3
"""Move a running terminal using supported App commands; never relaunch it."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import time


def call(program, *args):
    reply = subprocess.run([program, *args], capture_output=True, text=True, timeout=8)
    try: result = json.loads(reply.stdout)
    except ValueError: raise RuntimeError("Herdr did not return a command result") from None
    if reply.returncode or "error" in result:
        raise RuntimeError(str(result.get("error", "Herdr command failed")))
    return result


def locate(snapshot, terminal=None, pane=None):
    for space in snapshot["spaces"]:
        for tab in space["tabs"]:
            for leaf in tab["terminals"]:
                if (terminal is not None and leaf.get("terminal") == terminal) or (pane is not None and leaf.get("pane") == pane):
                    return space, tab, leaf
    return None


def identity(t):
    return (t.get("pid"), t.get("created_ms"), t.get("foreground", {}).get("pid"))


def move(terminal, destination, direction, api=call, wait=time.sleep):
    if direction not in ("right", "down"): raise ValueError("Choose right or below")
    snapshot = api("herdr-app", "ls")
    source = locate(snapshot, terminal=terminal)
    target = locate(snapshot, pane=destination)
    if not source or not target or not target[2].get("terminal"): raise RuntimeError("That pane is no longer available")
    if source[0].get("machine") != target[0].get("machine"): raise RuntimeError("Choose a tab on the same machine")
    if source[1]["id"] == target[1]["id"]: raise RuntimeError("The terminal is already in that tab")
    if source[0].get("machine"): raise RuntimeError("This move menu currently supports this computer")
    original = api("hc", "get", terminal)
    if original.get("state") != "live": raise RuntimeError("The terminal has finished")
    original_identity = identity(original)

    def ensure_live():
        current = api("hc", "get", terminal)
        if current.get("state") != "live" or identity(current) != original_identity:
            raise RuntimeError("The terminal's program changed during the move")
        return current

    def wait_for(predicate):
        for _ in range(80):
            current = ensure_live()
            at = locate(api("herdr-app", "ls"), terminal=terminal)
            if predicate(at, current): return at
            wait(0.05)
        raise RuntimeError("Herdr has not finished applying the move; the terminal was not restarted")

    parked = False
    placement_pending = False
    try:
        api("herdr-app", "do", "terminal.park", "--terminal", terminal)
        wait_for(lambda at, _: at is None)
        parked = True
        ensure_live()
        target_now = locate(api("herdr-app", "ls"), pane=destination)
        if not target_now or target_now[1]["id"] != target[1]["id"]:
            raise RuntimeError("The destination closed during the move")
        api("herdr-app", "do", "pane.focus", "--pane", destination)
        if api("herdr-app", "status").get("focused_pane") != destination:
            raise RuntimeError("The destination could not be focused")
        api("herdr-app", "do", "terminal.keep", "--terminal", terminal, "--place", direction)
        placement_pending = True
        placed = wait_for(lambda at, current: at is not None and current.get("keep") is True)
        parked = False
        if placed[1]["id"] != target[1]["id"]:
            raise RuntimeError("Focus changed during placement; the running terminal is in another tab")
        return {"ok": True, "terminal": terminal, "pane": placed[2]["pane"], "tab": placed[1]["id"]}
    except Exception as error:
        # Recover only a confirmed parked terminal; never replay an uncertain write.
        recovered = False
        if parked and not placement_pending:
            try:
                ensure_live()
                if locate(api("herdr-app", "ls"), terminal=terminal) is None:
                    api("herdr-app", "do", "terminal.keep", "--terminal", terminal, "--place", "tab")
                    wait_for(lambda at, current: at is not None and current.get("keep") is True)
                    recovered = True
            except Exception: pass
        return {"ok": False, "terminal": terminal, "error": str(error), "recovered": recovered}


if __name__ == "__main__":
    lock_path = Path.home() / ".local/state/herdr-app-move.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = move(*sys.argv[1:])
        except Exception as error:
            result = {"ok": False, "error": str(error)}
        print(json.dumps(result))
        sys.exit(0 if result.get("ok") else 1)
