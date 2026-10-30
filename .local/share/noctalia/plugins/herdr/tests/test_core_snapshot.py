import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("core_snapshot", Path(__file__).parents[1] / "core_snapshot.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CoreSnapshotTests(unittest.TestCase):
    def test_child_with_its_own_pane_stays_in_its_own_workspace(self):
        records = [
            {"address": "t1", "state": "live", "labels": {"herdr.space": "home", "herdr.tab": "tab1"}},
            {"address": "t9", "state": "live", "parent": "t1", "labels": {"herdr.space": "project", "herdr.tab": "tab2"}},
        ]
        spaces = {s["id"]: s for s in module.snapshot(records)["spaces"]}
        self.assertEqual(spaces["home"]["tabs"][0]["terminals"][0]["sub_agents"], [])
        self.assertEqual(spaces["project"]["tabs"][0]["terminals"][0]["terminal"], "t9")

    def test_completions_keep_the_apps_unseen_attention_semantics(self):
        records = [{"address": "t1", "state": "live", "labels": {"herdr.space": "sp1", "herdr.tab": "tb1"}, "status": {"state": "idle"}}]
        for attention in [{"word": "working", "seen": True}, {"word": "idle", "seen": False}]:
            result = module.snapshot(records, {"t1": attention})
            self.assertEqual(result["spaces"][0]["tabs"][0]["terminals"][0]["status"], "done")
        result = module.snapshot(records, {"t1": {"word": "idle", "seen": True}})
        self.assertEqual(result["spaces"][0]["tabs"][0]["terminals"][0]["status"], "idle")

    def test_focus_reopens_the_window_once_then_targets_the_same_terminal(self):
        with patch.object(module.subprocess, "run", side_effect=[
            SimpleNamespace(returncode=1, stderr="no Herdr window"),
            SimpleNamespace(returncode=0),
        ]) as run, patch.object(module.subprocess, "Popen") as launch, patch.object(module.time, "sleep"):
            module.focus_terminal("remote/t1")
            launch.assert_called_once()
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args.args[0][-1], "remote/t1")
        with self.assertRaises(ValueError):
            module.focus_terminal("t1; echo bad")

    def test_only_app_terminals_and_their_children_are_included(self):
        records = [
            {"address": "t1", "state": "live", "labels": {"herdr.space": "sp1", "herdr.tab": "tb1", "where": "demo / Fix login"}, "status": {"state": "working", "app": "codex"}},
            {"address": "t2", "state": "live", "parent": "t1", "status": {"state": "blocked", "app": "claude"}},
            {"address": "t3", "state": "live", "status": {"state": "working"}},
            {"address": "t4", "state": "finished", "labels": {"herdr.space": "sp1", "herdr.tab": "tb1"}},
        ]
        result = module.snapshot(records)
        self.assertFalse(result["window_open"])
        self.assertEqual(len(result["spaces"]), 1)
        space = result["spaces"][0]
        self.assertEqual(space["name"], "demo")
        tab = space["tabs"][0]
        self.assertEqual(tab["name"], "Fix login")
        self.assertEqual(len(tab["terminals"]), 1)
        parent = tab["terminals"][0]
        self.assertEqual(parent["status"], "working")
        self.assertEqual(parent["sub_agents"][0]["terminal"], "t2")

    def test_remote_ids_and_parents_do_not_collide_with_local_ids(self):
        labels = {"herdr.space": "sp1", "herdr.tab": "tb1"}
        records = [
            {"address": "t1", "state": "live", "labels": labels},
            {"address": "remote/t1", "state": "live", "labels": labels},
            {"address": "remote/t2", "state": "live", "parent": "t1"},
        ]
        spaces = {s["id"]: s for s in module.snapshot(records)["spaces"]}
        self.assertEqual(len(spaces["sp1"]["tabs"][0]["terminals"][0]["sub_agents"]), 0)
        remote = spaces["remote/sp1"]["tabs"][0]["terminals"][0]
        self.assertEqual(remote["sub_agents"][0]["terminal"], "remote/t2")


if __name__ == "__main__":
    unittest.main()
