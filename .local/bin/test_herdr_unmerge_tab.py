import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("unmerge", Path(__file__).with_name("herdr-unmerge-tab.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SplitApp:
    def __init__(self):
        self.tabs = {"group": [{"terminal": t, "pane": "p-" + t} for t in "abc"]}
        self.terminals = {t: {"state": "live", "pid": i + 10, "created_ms": i + 100,
                             "foreground": {"pid": i + 1000}, "keep": True} for i, t in enumerate("abc")}
        self.focus = "p-a"; self.commands = []; self.changed_after_first = False
        self.names = {"group": "Original group"}

    def call(self, program, *args):
        if program == "hc":
            if args[0] == "label":
                key,value = args[2].split("=",1)
                self.terminals[args[1]].setdefault("labels",{})[key] = value
                return {}
            return copy.deepcopy(self.terminals[args[-1]])
        if args == ("ls",):
            return {"spaces": [{"id": "s", "machine": None, "tabs": [
                {"id": key, "name": self.names.get(key,key), "terminals": copy.deepcopy(leaves)} for key, leaves in self.tabs.items() if leaves]}]}
        if args == ("status",): return {"focused_pane": self.focus, "space": "s"}
        command = args[1]; options = dict(zip(args[2::2], args[3::2])); self.commands.append((command, options))
        if command == "terminal.park":
            t = options["--terminal"]
            for leaves in self.tabs.values(): leaves[:] = [p for p in leaves if p.get("terminal") != t]
            self.terminals[t]["keep"] = False
        elif command == "space.select": pass
        elif command == "tab.rename": self.names[options["--id"]] = options["--name"]
        elif command == "terminal.keep":
            t = options["--terminal"]
            self.tabs["own-" + t] = [{"terminal": t, "pane": "new-" + t}]
            self.terminals[t]["keep"] = True; self.focus = "new-" + t
            if t == "b" and self.changed_after_first: self.terminals["c"]["foreground"]["pid"] += 1
        elif command == "pane.focus": self.focus = options["--pane"]
        else: raise AssertionError(command)
        return {"pending": True}


class UnmergeTests(unittest.TestCase):
    def test_group_keeps_first_tab_and_separates_the_other_processes_in_order(self):
        app = SplitApp(); original = copy.deepcopy(app.terminals)
        result = module.unmerge("group", api=app.call, wait=lambda _: None)
        self.assertTrue(result["ok"])
        self.assertEqual({t:{k:v for k,v in state.items() if k != "labels"} for t,state in app.terminals.items()}, original)
        self.assertEqual([r["terminal"] for r in result["moved"]], ["b", "c"])
        self.assertEqual(app.tabs["group"], [{"terminal": "a", "pane": "p-a"}])
        self.assertEqual(app.focus, "p-a")

    def test_individual_pane_moves_leave_the_other_panes_in_the_group(self):
        app = SplitApp()
        result = module.unmerge("group", "a", api=app.call, wait=lambda _: None)
        self.assertTrue(result["ok"])
        self.assertEqual([p["terminal"] for p in app.tabs["group"]], ["b", "c"])
        self.assertEqual(app.focus, "new-a")

    def test_preflight_rejects_mixed_groups_and_finished_or_missing_sources_without_mutation(self):
        for failure in ("document", "finished", "missing"):
            app = SplitApp()
            if failure == "document": app.tabs["group"].append({"pane": "notes"})
            if failure == "finished": app.terminals["c"]["state"] = "finished"
            if failure == "missing": app.tabs.clear()
            with self.assertRaises(RuntimeError): module.unmerge("group", api=app.call, wait=lambda _: None)
            self.assertEqual(app.commands, [])

    def test_partial_failure_reports_moved_panes_and_preserves_the_changed_remaining_source(self):
        app = SplitApp(); app.changed_after_first = True
        result = module.unmerge("group", api=app.call, wait=lambda _: None)
        self.assertFalse(result["ok"]); self.assertEqual(len(result["moved"]), 1)
        self.assertEqual([p["terminal"] for p in app.tabs["group"]], ["a", "c"])
        self.assertTrue(all(t["keep"] for t in app.terminals.values()))

    def test_group_unmerge_restores_each_panes_premerge_name_and_retains_the_group_name(self):
        app = SplitApp()
        for address,name in [("b","Second task"),("c","Third task")]:
            app.terminals[address]["labels"] = {module.movement.TITLE_LABEL: json.dumps({
                "name":name,"tab":"previous-"+address,"pid":app.terminals[address]["pid"],
                "created_ms":app.terminals[address]["created_ms"]})}
        result = module.unmerge("group",api=app.call,wait=lambda _:None)
        self.assertTrue(result["ok"])
        self.assertEqual(app.names, {"group":"Original group","own-b":"Second task","own-c":"Third task"})


if __name__ == "__main__": unittest.main()
