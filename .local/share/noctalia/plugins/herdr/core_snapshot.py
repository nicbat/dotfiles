#!/usr/bin/env python3
"""Read Herdr App's kept terminals when its window is closed."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def query(*args):
    result = subprocess.run(["hc", *args], capture_output=True, text=True, timeout=3, check=True)
    return json.loads(result.stdout)


def snapshot(records, attention=None):
    attention = attention or {}
    spaces = {}
    tabs = {}
    nodes = {}
    destinations = {}
    pane_roots = set()
    def parent_of(terminal):
        parent = terminal.get("parent")
        if parent and "/" in terminal["address"] and "/" not in parent:
            return terminal["address"].split("/", 1)[0] + "/" + parent
        return parent
    for terminal in records:
        if terminal.get("state") != "live":
            continue
        address = terminal["address"]
        labels = terminal.get("labels") or {}
        space_id, tab_id = labels.get("herdr.space"), labels.get("herdr.tab")
        if not space_id or not tab_id:
            continue
        machine = address.split("/", 1)[0] if "/" in address else None
        prefix = machine + "/" if machine else ""
        space_id, tab_id = prefix + space_id, prefix + tab_id
        where = labels.get("where", "")
        space_name, separator, tab_name = where.partition(" / ")
        space = spaces.setdefault(space_id, {
            "id": space_id, "name": space_name or space_id, "machine": machine, "tabs": [],
        })
        key = (space_id, tab_id)
        if key not in tabs:
            tabs[key] = {"id": tab_id, "name": tab_name if separator else tab_id, "terminals": []}
            space["tabs"].append(tabs[key])
        destinations[address] = tabs[key]["terminals"]
        pane_roots.add(address)
    # Attach children without app labels to their parent's tab, as the app does.
    remaining = [t for t in records if t.get("state") == "live"]
    for _ in range(len(remaining)):
        changed = False
        for terminal in remaining:
            address = terminal["address"]
            if address in destinations:
                continue
            parent = parent_of(terminal)
            if parent in destinations:
                destinations[address] = destinations[parent]
                changed = True
        if not changed:
            break
    for terminal in remaining:
        address = terminal["address"]
        if address not in destinations:
            continue
        status = terminal.get("status") or {}
        word = status.get("state")
        last_seen = attention.get(address) or {}
        if word == "idle" and (last_seen.get("word") in ("working", "blocked") or
                               (last_seen.get("word") == "idle" and last_seen.get("seen") is False)):
            word = "done"
        nodes[address] = {
            "terminal": address,
            "name": terminal.get("title") or terminal.get("name"),
            "status": word,
            "app": status.get("app"),
            "seq": terminal.get("status_ms", 0),
            "sub_agents": [],
        }
    for terminal in remaining:
        address = terminal["address"]
        if address not in nodes:
            continue
        parent = parent_of(terminal)
        if parent in nodes and address not in pane_roots:
            nodes[parent]["sub_agents"].append(nodes[address])
        else:
            destinations[address].append(nodes[address])
    return {"spaces": list(spaces.values()), "window_open": False}


def focus_terminal(address):
    if not re.fullmatch(r"(?:[\w.-]+/)?t[\w-]+", address, flags=re.ASCII):
        raise ValueError("Invalid terminal address")
    deadline = time.monotonic() + 4
    launched = False
    while True:
        result = subprocess.run(["herdr-app", "do", "agent.focus", "--terminal", address],
                                capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            return
        if "no Herdr window" not in result.stderr or time.monotonic() >= deadline:
            raise RuntimeError(result.stderr.strip() or "Could not focus Herdr App")
        if not launched:
            subprocess.Popen(["herdr-app"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
            launched = True
        time.sleep(0.15)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--focus":
        focus_terminal(sys.argv[2])
        return
    brief = query("ls", "--json")
    addresses = [t["address"] for t in brief.get("terminals", []) if t.get("state") == "live"][:200]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        records = list(pool.map(lambda address: query("get", address), addresses))
    app_home = Path(os.environ.get("HERDR_APP_HOME", str(Path.home() / ".config/herdr-app")))
    try:
        attention = json.loads((app_home / "view.json").read_text()).get("attention", {})
    except (OSError, ValueError):
        attention = {}
    print(json.dumps(snapshot(records, attention), ensure_ascii=False))


if __name__ == "__main__":
    main()
