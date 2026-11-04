import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("move", Path(__file__).with_name("herdr-move-terminal.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class App:
    def __init__(self):
        self.t = {"state": "live", "pid": 1, "created_ms": 2, "foreground": {"pid": 3}, "keep": True}
        self.placed = "source"; self.focus = "p-source"; self.commands = []; self.pending = 0
        self.remove_destination = False; self.fail_keep = False; self.change_focus = False
        self.hold_keep = False

    def snapshot(self):
        tabs = []
        for name in ("source", "target", "recovered"):
            if name == "target" and self.remove_destination and self.placed is None: continue
            leaves = [{"terminal": "dest", "pane": "p-target"}] if name == "target" else []
            if self.placed == name: leaves.append({"terminal": "t", "pane": "p-source" if name == "source" else "p-moved"})
            if leaves: tabs.append({"id": name, "name": name, "terminals": leaves})
        return {"spaces": [{"id": "s", "machine": None, "tabs": tabs}]}

    def call(self, program, *args):
        if program == "hc": return copy.deepcopy(self.t)
        if args == ("ls",):
            if self.pending:
                self.pending -= 1
                if not self.pending: self.placed = None; self.t["keep"] = False
            return self.snapshot()
        if args == ("status",): return {"focused_pane": self.focus}
        command = args[1]; self.commands.append(command)
        if command == "terminal.park": self.pending = 2
        elif command == "pane.focus": self.focus = "p-target"
        elif command == "terminal.keep":
            if self.fail_keep and args[-1] != "tab": raise RuntimeError("Destination unavailable")
            if self.hold_keep: return {"pending": True}
            self.placed = "recovered" if args[-1] == "tab" else "source" if self.change_focus else "target"
            self.t["keep"] = True
        else: raise AssertionError(command)
        return {"pending": True}


class MoveTests(unittest.TestCase):
    def test_pending_move_preserves_program_and_core_keep(self):
        app = App(); original = copy.deepcopy(app.t)
        result = module.move("t", "p-target", "right", app.call, lambda _: None)
        self.assertTrue(result["ok"]); self.assertEqual(result["tab"], "target")
        self.assertEqual(app.t, original)
        self.assertEqual(app.commands, ["terminal.park", "pane.focus", "terminal.keep"])

    def test_disappearing_target_or_failed_keep_recovers_own_tab(self):
        for failure in ("remove_destination", "fail_keep"):
            app = App(); setattr(app, failure, True)
            result = module.move("t", "p-target", "down", app.call, lambda _: None)
            self.assertFalse(result["ok"]); self.assertTrue(result["recovered"])
            self.assertEqual(app.placed, "recovered"); self.assertTrue(app.t["keep"])

    def test_same_tab_and_stale_target_fail_before_any_mutation(self):
        for target in ("p-source", "missing"):
            app = App()
            with self.assertRaises(RuntimeError): module.move("t", target, "right", app.call, lambda _: None)
            self.assertEqual(app.commands, [])

    def test_focus_race_is_not_reported_as_a_success(self):
        app = App(); app.change_focus = True
        result = module.move("t", "p-target", "right", app.call, lambda _: None)
        self.assertFalse(result["ok"])
        self.assertTrue(app.t["keep"]); self.assertEqual(app.t["pid"], 1)

    def test_uncertain_keep_is_not_replayed_as_a_second_placement(self):
        app = App(); app.hold_keep = True
        result = module.move("t", "p-target", "right", app.call, lambda _: None)
        self.assertFalse(result["ok"]); self.assertFalse(result["recovered"])
        self.assertEqual(app.commands.count("terminal.keep"), 1)
        self.assertEqual(app.t["state"], "live")


if __name__ == "__main__": unittest.main()
