#!/usr/bin/env python3
"""Move a running terminal using supported App commands; never relaunch it."""
import fcntl
import json
from pathlib import Path
import re
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


TITLE_LABEL = "nic.tab-title"


def remembered_title(terminal):
    try:
        record = json.loads(terminal.get("labels", {}).get(TITLE_LABEL, "null"))
        if (isinstance(record, dict) and isinstance(record.get("tab"), str) and record["tab"]
                and isinstance(record.get("name"), str) and record["name"].strip()
                and record.get("pid") == terminal.get("pid")
                and record.get("created_ms") == terminal.get("created_ms")):
            return record
    except (ValueError, TypeError): pass
    return None


def saved_title(at, terminal):
    space, tab, _leaf = at
    name = tab.get("name", "")
    generated = {p.get("terminal") for p in tab["terminals"]}
    previous = remembered_title(terminal)
    if len(tab["terminals"]) > 1 and previous and previous.get("tab") != tab["id"]:
        return previous  # This pane keeps its pre-merge name, not the group's name.
    if not name or name in generated:
        title = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", terminal.get("title") or "")
        title = re.sub(r"[\x00-\x1f\x7f]", "", title).strip()
        title = re.sub(r"^[^\w~/\\]+", "", title).strip()
        title = re.sub(r"^(?:Action Required|Working|Done|Idle)\s+\|\s+", "", title, flags=re.I)
        for suffix in (space.get("name"), Path(terminal.get("foreground", {}).get("cwd") or terminal.get("cwd") or "").name):
            if suffix and title.endswith(" | " + suffix): title = title[:-(len(suffix) + 3)].strip()
        name = (previous or {}).get("name") or title or terminal.get("name") or "Terminal"
    return {"tab": tab["id"], "name": name,
            "pid": terminal.get("pid"), "created_ms": terminal.get("created_ms")}


def remember_title(address, record, api):
    api("hc", "label", address, TITLE_LABEL + "=" + json.dumps(record, ensure_ascii=False))


def move(terminal, destination, direction, api=call, wait=time.sleep, expected=None):
    if direction not in ("right", "down", "tab"): raise ValueError("Choose right, below or own tab")
    snapshot = api("herdr-app", "ls")
    source = locate(snapshot, terminal=terminal)
    target = locate(snapshot, pane=destination) if direction != "tab" else None
    if not source: raise RuntimeError("That pane is no longer available")
    if direction == "tab":
        if len(source[1]["terminals"]) < 2: raise RuntimeError("The terminal already has its own tab")
    else:
        if not target or not target[2].get("terminal"): raise RuntimeError("That pane is no longer available")
        if source[0].get("machine") != target[0].get("machine"): raise RuntimeError("Choose a tab on the same machine")
        if source[1]["id"] == target[1]["id"]: raise RuntimeError("The terminal is already in that tab")
    if source[0].get("machine"): raise RuntimeError("This move menu currently supports this computer")
    original = api("hc", "get", terminal)
    if original.get("state") != "live": raise RuntimeError("The terminal has finished")
    original_identity = identity(original)
    if expected is not None:
        actual = {"source_pane": source[2]["pane"], "source_tab": source[1]["id"],
                  "target_tab": target[1]["id"] if target else None, "pid": original_identity[0],
                  "created_ms": original_identity[1], "foreground_pid": original_identity[2]}
        if actual != expected:
            raise RuntimeError("The source or destination changed after the drag; no move was made")
    title = saved_title(source, original)

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

    def restore_title(at):
        tab_id = at[1]["id"]
        if at[1].get("name") != title["name"]:
            api("herdr-app", "do", "tab.rename", "--id", tab_id, "--name", title["name"])
            at = wait_for(lambda at, _: at is not None and at[1]["id"] == tab_id and at[1].get("name") == title["name"])
        remember_title(terminal, {**title, "tab": tab_id}, api)
        return at

    parked = False
    placement_pending = False
    try:
        remember_title(terminal, title, api)
        api("herdr-app", "do", "terminal.park", "--terminal", terminal)
        wait_for(lambda at, _: at is None)
        parked = True
        ensure_live()
        if direction == "tab":
            api("herdr-app", "do", "space.select", "--id", source[0]["id"])
            if api("herdr-app", "status").get("space") != source[0]["id"]:
                raise RuntimeError("The original space could not be selected")
        else:
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
        if direction == "tab" and (placed[0]["id"] != source[0]["id"] or placed[1]["id"] == source[1]["id"]):
            raise RuntimeError("Focus changed during placement; the running terminal is in another tab")
        if direction != "tab" and placed[1]["id"] != target[1]["id"]:
            raise RuntimeError("Focus changed during placement; the running terminal is in another tab")
        if direction == "tab": placed = restore_title(placed)
        return {"ok": True, "terminal": terminal, "pane": placed[2]["pane"], "tab": placed[1]["id"]}
    except Exception as error:
        # Recover only a confirmed parked terminal; never replay an uncertain write.
        recovered = False
        if parked and not placement_pending:
            try:
                ensure_live()
                if locate(api("herdr-app", "ls"), terminal=terminal) is None:
                    api("herdr-app", "do", "terminal.keep", "--terminal", terminal, "--place", "tab")
                    restored = wait_for(lambda at, current: at is not None and current.get("keep") is True)
                    recovered = True
                    restore_title(restored)
            except Exception: pass
        return {"ok": False, "terminal": terminal, "error": str(error), "recovered": recovered}


if __name__ == "__main__":
    lock_path = Path.home() / ".local/state/herdr-app-move.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = move(*sys.argv[1:4], expected=json.loads(sys.argv[4]) if len(sys.argv) == 5 else None)
        except Exception as error:
            result = {"ok": False, "error": str(error)}
        print(json.dumps(result))
        sys.exit(0 if result.get("ok") else 1)
