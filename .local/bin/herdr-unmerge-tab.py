#!/usr/bin/env python3
"""Separate terminal panes through supported commands, retaining each process."""
import fcntl
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("herdr_move", Path(__file__).with_name("herdr-move-terminal.py"))
movement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(movement)


def unmerge(tab_id, terminal=None, api=movement.call, wait=movement.time.sleep):
    snapshot = api("herdr-app", "ls")
    at = next(((s, t) for s in snapshot["spaces"] for t in s["tabs"] if t["id"] == tab_id), None)
    if not at or at[0].get("machine") or len(at[1]["terminals"]) < 2:
        raise RuntimeError("Choose a local split tab")
    leaves = at[1]["terminals"]
    if terminal:
        selected = [p for p in leaves if p.get("terminal") == terminal]
        if len(selected) != 1: raise RuntimeError("That terminal is no longer in the split")
    else:
        if any(not p.get("terminal") for p in leaves):
            raise RuntimeError("This group includes document panes; move its terminal panes individually")
        selected = leaves[1:]  # Keep the original tab and its first pane.
    requests = []
    for leaf in selected:
        address = leaf.get("terminal")
        if not address or "/" in address: raise RuntimeError("Choose a local terminal pane")
        current = api("hc", "get", address)
        if current.get("state") != "live": raise RuntimeError("A selected terminal has finished")
        pid, created, foreground = movement.identity(current)
        requests.append((address, {"source_pane": leaf["pane"], "source_tab": tab_id,
            "target_tab": None, "pid": pid, "created_ms": created, "foreground_pid": foreground}))
    moved = []
    for address, expected in requests:
        try:
            result = movement.move(address, None, "tab", api=api, wait=wait, expected=expected)
        except Exception as error:
            result = {"ok": False, "error": str(error)}
        if not result["ok"]:
            return {"ok": False, "moved": moved, "error": result["error"], "recovered": result.get("recovered", False)}
        moved.append(result)
    # Restore the group's first pane only while focus is still on our last placement.
    if not terminal and moved and api("herdr-app", "status").get("focused_pane") == moved[-1]["pane"]:
        api("herdr-app", "do", "pane.focus", "--pane", leaves[0]["pane"])
    return {"ok": True, "moved": moved, "tab": tab_id}


if __name__ == "__main__":
    lock_path = Path.home() / ".local/state/herdr-app-move.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = unmerge(*sys.argv[1:])
        except Exception as error:
            result = {"ok": False, "moved": [], "error": str(error)}
        print(json.dumps(result))
        sys.exit(0 if result["ok"] else 1)
