#!/usr/bin/env python3
"""Pane-to-pane help for agents: who am I, what did that agent last say, ask or tell it.

  map                 (Herdr side) record each terminal's processes and session
  whoami [--json]     the caller's terminal address and place
  last <t> [--write]  the agent's final message, from its own transcript
  ask <t> <message>   send with a reply header, wait for its turn, print its final message
  tell <t> <message>  send with a reply header, don't wait

Agents under declawd can't run ps and don't see HC_TERMINAL_ID, so the Herdr
mod runs `map` every few seconds; everything else reads that map.
"""
import argparse
import glob
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

HOME = Path.home()
STATE = HOME / ".local/state/herdr-agents"
MAP = STATE / "map.json"
HANDOFF = Path("/tmp/herdr-handoff")
CLAUDE_SESSIONS = HOME / ".claude/sessions"
CLAUDE_PROJECTS = HOME / ".claude/projects"
CODEX_SESSIONS = HOME / ".codex/sessions"
CODEX_RECORDS = HOME / ".local/state/herdr-native-status"
PI_SESSIONS = HOME / ".pi/agent/sessions"
MAP_FRESH_MS = 60000
NEAR_MS = 10000
HC = shutil.which("hc") or str(HOME / ".local/bin/hc")
KINDS = {"claude-code": "claude", "claude": "claude", "codex": "codex", "pi": "pi"}


def now_ms():
    return int(time.time() * 1000)


def hc(*args, timeout=15):
    reply = subprocess.run([HC, *args, "--json"], capture_output=True, text=True, timeout=timeout)
    try: return json.loads(reply.stdout)
    except ValueError: raise RuntimeError((reply.stderr or reply.stdout or "hc failed").strip()) from None


def read_json(path):
    try: return json.loads(Path(path).read_text())
    except (OSError, ValueError): return None


def jsonl(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try: rows.append(json.loads(line))
                except ValueError: pass
    except OSError: pass
    return rows


def first_json(path):
    try:
        with open(path, encoding="utf-8") as handle: return json.loads(handle.readline())
    except (OSError, ValueError): return None


def tilde(path):
    path = str(path or "")
    return "~" + path[len(str(HOME)):] if path == str(HOME) or path.startswith(str(HOME) + "/") else path


def place(terminal):
    return (terminal.get("labels") or {}).get("where") or terminal.get("where") or ""


def folder(terminal):
    return (terminal.get("foreground") or {}).get("cwd") or terminal.get("cwd") or ""


def kind(terminal):
    status = terminal.get("status")
    app = status.get("app") if isinstance(status, dict) else terminal.get("agent")
    return KINDS.get(app or terminal.get("agent"))


def state(terminal):
    status = terminal.get("status")
    return status.get("state") if isinstance(status, dict) else status


# --- Processes (Herdr side only) -------------------------------------------

def process_tree(ps_output):
    children = {}
    for line in ps_output.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            children.setdefault(int(parts[1]), []).append(int(parts[0]))
    return children


def descendants(children, root):
    found, todo = [], [root]
    while todo:
        pid = todo.pop()
        if pid in found: continue
        found.append(pid)
        todo.extend(children.get(pid, []))
    return found


# --- Finding a terminal's session ------------------------------------------

def claude_transcript(session, cwd):
    exact = CLAUDE_PROJECTS / re.sub(r"[^A-Za-z0-9]", "-", cwd or "") / f"{session}.jsonl"
    if exact.exists(): return exact
    found = glob.glob(str(CLAUDE_PROJECTS / "*" / f"{session}.jsonl"))
    return Path(found[0]) if found else None


def claude_session(pids):
    for pid in pids:
        record = read_json(CLAUDE_SESSIONS / f"{pid}.json")
        if record and record.get("sessionId"):
            path = claude_transcript(record["sessionId"], record.get("cwd"))
            if path: return {"session": record["sessionId"], "transcript": str(path), "match": "process"}
    return None


def codex_rollout(session):
    found = glob.glob(str(CODEX_SESSIONS / "**" / f"*{session}.jsonl"), recursive=True)
    return max(found, key=os.path.getmtime) if found else None


def recent_files(pattern, limit=200):
    files = glob.glob(pattern, recursive=True)
    return sorted(files, key=os.path.getmtime, reverse=True)[:limit]


def closest(candidates, at):
    """The single candidate nearest `at` (ms) within NEAR_MS, or None when two tie."""
    near = sorted((abs(when - at), value) for when, value in candidates if abs(when - at) <= NEAR_MS)
    if not near or (len(near) > 1 and near[1][0] - near[0][0] < 1000): return None
    return near[0][1]


def codex_session(terminal):
    labelled = (terminal.get("labels") or {}).get("herdr.codex.session")
    if labelled and (path := codex_rollout(labelled)):
        return {"session": labelled, "transcript": path, "match": "label"}
    cwd, at = folder(terminal), terminal.get("status_ms") or 0
    records = [read_json(p) for p in glob.glob(str(CODEX_RECORDS / "*.json"))]
    session = closest([(r.get("observed_ms") or 0, r["session_id"]) for r in records
                       if r and r.get("cwd") == cwd and r.get("session_id") and not r.get("ignored")], at)
    if session and (path := codex_rollout(session)):
        return {"session": session, "transcript": path, "match": "timing"}
    files = [(os.path.getmtime(p) * 1000, p) for p in recent_files(str(CODEX_SESSIONS / "**" / "*.jsonl"))
             if ((first_json(p) or {}).get("payload") or {}).get("cwd") == cwd]
    path = closest(files, at)
    return path and {"session": ((first_json(path) or {}).get("payload") or {}).get("id"), "transcript": path, "match": "timing"}


def pi_session(terminal):
    cwd, at = folder(terminal), terminal.get("status_ms") or 0
    files = [(os.path.getmtime(p) * 1000, p) for p in recent_files(str(PI_SESSIONS / "**" / "*.jsonl"))
             if (first_json(p) or {}).get("cwd") == cwd]
    path = closest(files, at)
    return path and {"session": (first_json(path) or {}).get("id"), "transcript": path, "match": "timing"}


def resolve(terminal, pids):
    agent = kind(terminal)
    if agent == "claude": found = claude_session(pids)
    elif agent == "codex": found = codex_session(terminal)
    elif agent == "pi": found = pi_session(terminal)
    else: found = None
    return {**found, "kind": agent} if found else None


# --- Final messages --------------------------------------------------------

def is_prompt(row):
    if row.get("type") != "user" or row.get("isMeta") or row.get("isSidechain"): return False
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str): return not content.startswith(("<command-", "<local-command", "<bash-"))
    return isinstance(content, list) and any(b.get("type") == "text" for b in content)


def claude_final(rows, working):
    rows = [r for r in rows if not r.get("isSidechain")]
    if working:
        prompts = [i for i, r in enumerate(rows) if is_prompt(r)]
        if prompts: rows = rows[:prompts[-1]]
    last_id, parts, when = None, [], None
    for row in reversed(rows):
        if row.get("type") != "assistant": continue
        message = row.get("message") or {}
        texts = [b.get("text", "") for b in message.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"]
        if last_id is None and texts: last_id, when = message.get("id"), row.get("timestamp")
        if last_id is not None and message.get("id") == last_id: parts[:0] = texts
        elif last_id is not None: break
    return ("\n\n".join(p for p in parts if p.strip()) or None), when


def codex_final(rows, working):
    for row in reversed(rows):
        payload = row.get("payload") or {}
        if row.get("type") == "event_msg" and payload.get("type") == "task_complete" and payload.get("last_agent_message"):
            return payload["last_agent_message"], row.get("timestamp")
    return None, None


def pi_final(rows, working):
    for row in reversed(rows):
        message = row.get("message") or {}
        if row.get("type") != "message" or message.get("role") != "assistant" or message.get("stopReason") == "toolUse": continue
        texts = [b.get("text", "") for b in message.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"]
        if any(t.strip() for t in texts): return "\n\n".join(texts), row.get("timestamp")
    return None, None


FINAL = {"claude": claude_final, "codex": codex_final, "pi": pi_final}


def letters(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def on_screen(text, screens):
    tail = letters(text)[-60:]
    return bool(tail) and any(tail in letters(screen) for screen in screens)


# --- The map ---------------------------------------------------------------

def write_map(listing, ps_output):
    children = process_tree(ps_output)
    entries = {}
    for terminal in listing.get("terminals", []):
        if terminal.get("state") != "live" or "/" in terminal.get("address", "") or not kind(terminal): continue
        detail = hc("get", terminal["address"])
        pids = descendants(children, detail["pid"]) if detail.get("pid") else []
        entries[terminal["address"]] = {"pids": pids, "place": place(detail), "cwd": folder(detail),
                                        **(resolve(detail, pids) or {"kind": kind(detail)})}
    STATE.mkdir(parents=True, exist_ok=True)
    old = read_json(MAP) or {}
    if old.get("terminals") != entries or now_ms() - (old.get("written_ms") or 0) > MAP_FRESH_MS / 2:
        temporary = STATE / f".map.{os.getpid()}.tmp"
        temporary.write_text(json.dumps({"written_ms": now_ms(), "terminals": entries}))
        temporary.replace(MAP)
    return entries


def read_map():
    data = read_json(MAP) or {}
    fresh = now_ms() - (data.get("written_ms") or 0) <= MAP_FRESH_MS
    return (data.get("terminals") or {}), fresh


def whoami(environ, entries):
    if environ.get("HC_TERMINAL_ID"): return environ["HC_TERMINAL_ID"]
    pid = environ.get("CLAUDE_PID")
    session = environ.get("CLAUDE_CODE_SESSION_ID") or environ.get("CODEX_THREAD_ID") or environ.get("CODEX_SESSION_ID")
    for address, entry in entries.items():
        if (pid and pid.isdigit() and int(pid) in entry.get("pids", [])) or (session and entry.get("session") == session):
            return address
    return None


def local_time(stamp):
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return stamp or "unknown"


def describe(address, terminal):
    where = place(terminal)
    return f"{address} — {where}" if where else address


# --- Commands --------------------------------------------------------------

def last(address, write=False, terminal=None):
    terminal = terminal or hc("get", address)
    if terminal.get("error"): raise RuntimeError(str(terminal["error"]))
    entries, fresh = read_map()
    entry = entries.get(terminal.get("address", address)) or {}
    found = entry.get("transcript") and entry
    if not found and entry.get("pids"):
        found = resolve(terminal, entry["pids"])
    if not found:
        try: ps_output = subprocess.run(["ps", "-axo", "pid=,ppid="], capture_output=True, text=True, timeout=5).stdout
        except OSError: ps_output = ""
        pids = descendants(process_tree(ps_output), terminal["pid"]) if ps_output and terminal.get("pid") else []
        found = resolve(terminal, pids)
    if not found: raise RuntimeError(f"No {kind(terminal) or 'agent'} session found for {address}"
                                     + ("" if fresh else " (the Herdr agent map is not running)"))
    working = state(terminal) == "working"
    text, when = FINAL[found["kind"]](jsonl(found["transcript"]), working)
    if not text: raise RuntimeError(f"{address} has no finished response yet" + (" (it's still working on its first turn)" if working else ""))
    screens = []
    for lines in ("0", "400"):
        try:
            screens.append(subprocess.run([HC, "read", "--lines", lines, address], capture_output=True, text=True, timeout=15).stdout)
        except (OSError, subprocess.TimeoutExpired): pass
        if on_screen(text, screens): break
    result = {"ok": True, "address": terminal.get("address", address), "place": place(terminal), "cwd": folder(terminal),
              "kind": found["kind"], "session": found.get("session"), "match": found.get("match"),
              "verified": on_screen(text, screens), "earlier_turn": working, "finished": when, "text": text}
    if write:
        HANDOFF.mkdir(parents=True, exist_ok=True)
        path = HANDOFF / f"{result['address'].replace('/', '_')}-{time.strftime('%Y%m%d-%H%M%S')}.md"
        notes = [f"- Place: {result['place'] or 'unknown'}", f"- Folder: {tilde(result['cwd'])}",
                 f"- Agent: {result['kind']}, session {result['session']}", f"- Finished: {local_time(when)}",
                 f"- Matched by {result['match']}; {'seen on its screen' if result['verified'] else 'NOT seen on its screen, check before relying on it'}"]
        if working: notes.append("- It was working when shared: this is its previous finished response")
        path.write_text(f"# Last response from {result['address']}\n\n" + "\n".join(notes) + "\n\n---\n\n" + text + "\n")
        where = f" ({result['place']})" if result["place"] else ""
        result.update(path=str(path), line=f"Read {result['address']}'s last response{where}: {path}")
    return result


def header(me, me_place, waiting=False):
    where = f" — {me_place}" if me_place and me else ""
    sender = f"from {me}{where}" if me else "from another agent"
    if waiting: return f"[{sender} · it's waiting for this turn's answer; just reply here, don't herdr-tell it]"
    return f'[{sender} · reply with: herdr-tell {me} "…"]' if me else f"[{sender}; it has no reply address]"


def send(address, message, wait=False, timeout=180):
    entries, _ = read_map()
    me = whoami(os.environ, entries)
    text = header(me, (entries.get(me) or {}).get("place"), waiting=wait) + "\n" + message
    target = hc("get", address)
    if target.get("error"): raise RuntimeError(str(target["error"]))
    was = state(target)
    args = ["send", *(["--wait", "--timeout", str(timeout)] if wait else []), address, text]
    reply = hc(*args, timeout=timeout + 30)
    if reply.get("error"): raise RuntimeError(str(reply["error"]))
    return me, was, reply


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("map")
    who = commands.add_parser("whoami"); who.add_argument("--json", action="store_true")
    show = commands.add_parser("last"); show.add_argument("terminal"); show.add_argument("--write", action="store_true")
    show.add_argument("--json", action="store_true")
    ask = commands.add_parser("ask"); ask.add_argument("terminal"); ask.add_argument("message")
    ask.add_argument("--timeout", type=int, default=180)
    tell = commands.add_parser("tell"); tell.add_argument("terminal"); tell.add_argument("message")
    args = parser.parse_args(argv)
    try:
        if args.command == "map":
            try:
                ps_output = subprocess.run(["ps", "-axo", "pid=,ppid="], capture_output=True, text=True, timeout=5, check=True).stdout
                write_map(hc("ls"), ps_output)
            except Exception as error:
                STATE.mkdir(parents=True, exist_ok=True)
                (STATE / "map.error").write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {error!r}\n")
                raise
        elif args.command == "whoami":
            entries, fresh = read_map()
            me = whoami(os.environ, entries)
            if args.json: print(json.dumps({"address": me, "place": (entries.get(me) or {}).get("place"), "map_fresh": fresh}))
            elif me: print(describe(me, {"where": (entries.get(me) or {}).get("place")}))
            else: raise RuntimeError("Can't tell which terminal this is" + ("" if fresh else " (the Herdr agent map is not running)"))
        elif args.command == "last":
            result = last(args.terminal, write=args.write)
            print(json.dumps(result) if args.json else (result.get("line") or result["text"]))
        elif args.command == "ask":
            me, was, reply = send(args.terminal, args.message, wait=True, timeout=args.timeout)
            after = hc("get", args.terminal)
            if state(after) == "working":
                print(f"{args.terminal} is still working after {args.timeout}s. Check later with "
                      f"`herdr-last {args.terminal}`, or wait for its herdr-tell{'' if me else ' (it has no reply address for you)'}.")
                return 2
            result = last(args.terminal, terminal=after)
            if was == "working": print(f"(note: {args.terminal} was already working; this reply may also cover its earlier task)")
            if not result["verified"]: print("(note: not seen on its screen; it may be another session's message)")
            print(result["text"])
        elif args.command == "tell":
            me, was, _ = send(args.terminal, args.message)
            print(f"Sent to {args.terminal}" + ("" if me else " without a reply address (can't tell which terminal this is)"))
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"herdr-agent: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
