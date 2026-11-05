#!/usr/bin/env python3
"""Observe styled visible composers/footers; never emit terminal text."""
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


def background_shells(raw, kind, rows=100, cols=400):
    """Port the legacy background-activity adapter's bounded footer counts.

    None means unavailable/unsupported, never zero. Counts aren't lifecycle state.
    """
    lines = ["".join(c for c, _ in line).strip() for line in screen_lines(raw, rows, cols)]
    if not lines or kind not in {"codex", "claude"}: return None
    if kind == "codex":
        def count_block(end):
            start = end
            while start > 0 and end - start < 5 and lines[start - 1]: start -= 1
            working = re.match(r"^[•◦] .+esc to interrupt.*?[·•] (\d+ background terminals? running.*)$", lines[start])
            block = working[1] if working else " ".join(lines[start:end + 1])
            match = re.fullmatch(r"(\d+) background terminal(s?) running(.*)", block)
            if match:
                n = int(match[1])
                if 1 <= n <= 10000 and (n == 1) == (match[2] == "") and " · /ps to view · /stop to close".startswith(match[3]):
                    return n, block
            return None, block

        statuses = [i for i, line in enumerate(lines) if re.search(
            r"\bContext\s+\d+%\s+used\b|\b\d+% context(?: window)? left\b", line, re.I)]
        # Expanded asynchronous questions replace the normal composer/status.
        final = lines[-1].lower()
        if all(h in final for h in ("submit", "skip", "main prompt")) and (not statuses or len(lines) - 1 > statuses[-1]):
            queued = [i for i, line in enumerate(lines) if line == "• Queued follow-up inputs"]
            if not queued: return None
            end = queued[-1] - 1
            while end >= 0 and not lines[end]: end -= 1
            return count_block(end)[0] if end >= 0 else None
        if not statuses or len(lines) - statuses[-1] > 4: return None
        status = statuses[-1]
        prompts = [i for i in range(status) if re.match(r"^›(?:\s|$)", lines[i])]
        if not prompts: return None
        prompt = prompts[-1]
        hints = " ".join(lines[status:]).lower()
        if any(h in hints for h in ("showing detailed transcript", "pgup/pgdn", "↑/↓ to scroll",
                                    "esc to close", "esc to cancel", "enter to confirm", "enter to select")):
            return None
        if "for shortcuts" not in hints and "to queue" not in hints and detect_draft(raw, kind, rows, cols) is not True:
            return None
        end = prompt - 1
        while end >= 0 and not lines[end]: end -= 1
        question = end >= 1 and lines[end].endswith(" to answer") and re.fullmatch(
            r"\? [1-9]\d* questions?(?: · .+)?", lines[end - 1])
        if question:
            end -= 2
            while end >= 0 and not lines[end]: end -= 1
            if end >= 0 and lines[end] == "• Queued follow-up inputs":
                end -= 1
                while end >= 0 and not lines[end]: end -= 1
        if end < 0: return 0 if prompt >= 3 and not question else None
        count, block = count_block(end)
        if count is not None: return count
        if "background terminal" in block.lower() or re.match(r"^\d+(?:\s|$)", block) or "esc to interrupt" in block:
            return None
        return 0 if prompt - end - 1 >= 2 and not question else None

    rules = [i for i, line in enumerate(lines) if len(line) >= 10 and set(line) == {"─"}]
    if len(rules) < 2: return None
    top, bottom = rules[-2:]
    footer_lines = lines[bottom + 1:]
    if "⏺ main" in footer_lines: footer_lines = footer_lines[:footer_lines.index("⏺ main")]
    while footer_lines and not footer_lines[-1]: footer_lines.pop()
    if bottom - top < 2 or len(footer_lines) > 8: return None
    prompt = top + 1
    while prompt < bottom and not lines[prompt]: prompt += 1
    if prompt >= bottom or not re.match(r"^❯(?:\s|$)", lines[prompt]): return None
    hints = " ".join(footer_lines).lower()
    if any(h in hints for h in ("esc to cancel", "esc to close", "enter to select", "enter to confirm",
                                "showing detailed transcript", "↑↓ scroll")): return None
    native = None
    mode = r"^(?:⏵⏵ (?:auto mode|accept edits|bypass permissions) on|⏸ plan mode on|\? for shortcuts)(?:\s|$)"
    for i in range(len(footer_lines) - 1, max(-1, len(footer_lines) - 5), -1):
        joined = " ".join(" ".join(footer_lines[i:]).split())
        if re.match(mode, joined) or (re.match(r"^[1-9]\d* shells?(?: ·|$)", joined) and
            joined.endswith("← for agents") and all(line.startswith("· ") for line in footer_lines[i + 1:])):
            native = joined
            break
    if native is None and footer_lines and any(h in footer_lines[-1] for h in ("shift+tab to cycle", "? for shortcuts", "← for agents")):
        native = footer_lines[-1]
    if native is None: return None
    counts = []
    for part in native.split(" · "):
        if "shell" not in part: continue
        match = re.fullmatch(r"([1-9]\d*) shell(s?)", part.strip())
        if not match: return None
        n = int(match[1])
        if n > 10000 or (n == 1) != (match[2] == ""): return None
        counts.append(n)
    return counts[0] if len(counts) == 1 else None


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
        text = raw.decode("utf-8", errors="replace")
        dimensions = (min(target.get("rows") or 100, 250), min(target.get("cols") or 400, 600))
        draft = detect_draft(text, target["kind"], *dimensions) if raw and len(raw) < 1024 * 1024 else None
        shells = background_shells(text, target["kind"], *dimensions) if raw and len(raw) < 1024 * 1024 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        draft = shells = None
    finally:
        if process and process.poll() is None:
            process.kill(); process.wait()
    return {"address": address, "identity": target["identity"], "draft": draft,
            "shells": shells, "checkedAt": int(time.time() * 1000)}


if __name__ == "__main__":
    targets = json.loads(sys.argv[1])
    if not isinstance(targets, list) or len(targets) > 100: raise ValueError("Invalid observation targets")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        print(json.dumps(list(pool.map(observe, targets))))
