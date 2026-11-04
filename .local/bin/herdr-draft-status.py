#!/usr/bin/env python3
"""Observe styled visible composers; emit booleans, never prompt text."""
import concurrent.futures
import json
import os
import re
import selectors
import subprocess
import sys
import time
import unicodedata

CSI = re.compile(r"\x1b\[([0-?]*)([ -/]*)([@-~])")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
CONTROL_STRING = re.compile(r"\x1b[PX^_].*?\x1b\\", re.S)


def screen_lines(raw, rows=100, cols=400):
    """Decode the observer's initial visible paint, retaining only faint style."""
    grid = [[(" ", False) for _ in range(cols)] for _ in range(rows)]
    row = col = 0
    dim = False
    raw = CONTROL_STRING.sub("", OSC.sub("", raw))
    i = 0
    while i < len(raw):
        m = CSI.match(raw, i)
        if m:
            params, _, command = m.groups()
            private = params.startswith("?")
            nums = [int(n) if n.isdigit() else 0 for n in params.lstrip("?").split(";")]
            n = nums[0] or 1
            if command in "Hf":
                row, col = max(0, n - 1), max(0, (nums[1] if len(nums) > 1 else 1) - 1)
            elif command == "G": col = n - 1
            elif command == "d": row = n - 1
            elif command == "A": row = max(0, row - n)
            elif command == "B": row += n
            elif command == "C": col += n
            elif command == "D": col = max(0, col - n)
            elif command == "J":
                if nums[0] in (2, 3):
                    grid = [[(" ", False) for _ in range(cols)] for _ in range(rows)]
                elif nums[0] == 0:
                    for y in range(min(row, rows), rows):
                        start = min(col, cols) if y == row else 0
                        grid[y][start:] = [(" ", False)] * (cols - start)
            elif command == "K" and row < rows:
                start, end = (0, cols) if nums[0] == 2 else (0, min(col + 1, cols)) if nums[0] == 1 else (min(col, cols), cols)
                grid[row][start:end] = [(" ", False)] * (end - start)
            elif command == "m" and not private:
                j = 0
                while j < len(nums):
                    code = nums[j]
                    if code in (0, 22): dim = False
                    elif code == 2: dim = True
                    elif code in (38, 48, 58) and j + 1 < len(nums):
                        j += 4 if nums[j + 1] == 2 else 2 if nums[j + 1] == 5 else 0
                    j += 1
            i = m.end()
            continue
        char = raw[i]
        if char == "\x1b":
            # Charset designators (e.g. ESC ( B) have a third byte. Treating
            # their final B as visible text falsely marks an empty composer.
            i += 3 if i + 1 < len(raw) and raw[i + 1] in "()*+-./%#" else 2
            continue
        if char == "\r": col = 0
        elif char == "\n": row += 1
        elif char == "\b": col = max(0, col - 1)
        elif char == "\t": col = (col // 8 + 1) * 8
        elif char >= " " and not unicodedata.combining(char):
            if 0 <= row < rows and 0 <= col < cols:
                grid[row][col] = (char, dim)
            col += 2 if unicodedata.east_asian_width(char) in "WF" else 1
        i += 1
    # Preserve styling by column. No text leaves this function's caller.
    result = []
    for cells in grid:
        end = len(cells)
        while end and cells[end - 1][0].isspace(): end -= 1
        result.append(cells[:end])
    while result and not result[-1]: result.pop()
    return result


def detect_draft(raw, kind, rows=100, cols=400):
    lines = screen_lines(raw, rows, cols)
    plain = ["".join(c for c, _ in line).strip() for line in lines]
    if not plain: return None
    if kind == "codex":
        status = [i for i, line in enumerate(plain) if re.search(r"\bContext\s+\d+%\s+used\b|\b\d+% context(?: window)? left\b", line, re.I)]
        if not status or len(plain) - status[-1] > 4: return None
        end = status[-1]
        hints = " ".join(plain[end:]).lower()
        if any(h in hints for h in ("esc to close", "esc to cancel", "enter to confirm", "enter to select", "pgup/pgdn", "↑/↓ to scroll", "showing detailed transcript")):
            return None
        prompts = [i for i in range(end) if re.match(r"^›(?:\s|$)", plain[i])]
        if not prompts: return None
        start = prompts[-1]
        if "for shortcuts" in hints: return False
    elif kind == "claude":
        rules = [i for i, line in enumerate(plain) if len(line) >= 10 and set(line) == {"─"}]
        if len(rules) < 2: return None
        top, end = rules[-2:]
        if end - top < 2 or len(plain) - end > 9: return None
        hints = " ".join(plain[end + 1:]).lower()
        if not any(h in hints for h in ("shift+tab to cycle", "? for shortcuts", "← for agents")):
            return None
        if any(h in hints for h in ("esc to cancel", "esc to close", "enter to select", "enter to confirm", "showing detailed transcript", "↑↓ scroll")):
            return None
        start = top + 1
        while start < end and not plain[start]: start += 1
        if start == end or not re.match(r"^❯(?:\s|$)", plain[start]): return None
    elif kind == "pi":
        rules = [i for i, line in enumerate(plain) if len(line) >= 10 and line.startswith("──")]
        if len(rules) < 2: return None
        top, end = rules[-2:]
        footer = " ".join(plain[end + 1:])
        if not re.search(r"(?:\d+(?:\.\d+)?|\?)%?/\d+[kM]?", footer): return None
        if re.search(r"esc to (?:cancel|close)|enter to (?:select|confirm)", footer, re.I): return None
        start = top + 1
    else: return None
    marker = "›" if kind == "codex" else "❯" if kind == "claude" else None
    for index in range(start, end):
        after = index > start or marker is None
        for char, faint in lines[index]:
            if not after:
                if char == marker: after = True
            elif not char.isspace() and not faint:
                return True
    return False


def observe(target):
    address = target["address"]
    process = None
    try:
        process = subprocess.Popen(["hc", "attach", "--observe", "--history", "0", address],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 0.8
        chunks, size, last = [], 0, None
        while time.monotonic() < deadline and size < 1024 * 1024:
            for key, _ in selector.select(0.03):
                chunk = os.read(key.fd, 65536)
                if chunk:
                    chunks.append(chunk); size += len(chunk); last = time.monotonic()
                else:
                    selector.unregister(key.fileobj)
            if process.poll() is not None or (last is not None and time.monotonic() - last > 0.09): break
        selector.close()
        if process.poll() is None: process.terminate()
        tail, _ = process.communicate(timeout=1)
        raw = b"".join(chunks) + tail
        draft = detect_draft(raw.decode("utf-8", errors="replace"), target["kind"],
                             min(target.get("rows") or 100, 250), min(target.get("cols") or 400, 600)) if raw and size < 1024 * 1024 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        draft = None
    finally:
        if process and process.poll() is None:
            process.kill(); process.wait()
    return {"address": address, "identity": target["identity"], "draft": draft, "checkedAt": int(time.time() * 1000)}


if __name__ == "__main__":
    targets = json.loads(sys.argv[1])
    if not isinstance(targets, list) or len(targets) > 100: raise ValueError("Invalid observation targets")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        print(json.dumps(list(pool.map(observe, targets))))
