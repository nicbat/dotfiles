import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("reporter", Path(__file__).with_name("herdr-native-status.py"))
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)


class LifecycleTests(unittest.TestCase):
    def test_turn_transitions_and_questions(self):
        for event, state in [("SessionStart", "idle"), ("UserPromptSubmit", "working"),
                             ("PermissionRequest", "blocked"), ("PostToolUse", "working"),
                             ("Stop", "done"), ("Interrupt", "idle")]:
            with self.subTest(event=event):
                self.assertIn(f"state={state}".encode(), reporter.report({"hook_event_name": event}, {}))
        self.assertIn(b"kind=question", reporter.report({"hook_event_name": "PreToolUse", "tool_name": "request_user_input"}, {}))
        self.assertEqual(reporter.report({"hook_event_name": "PreToolUse", "tool_name": "request_user_input_async"}, {}),
                         b"\x1b]7501;state=working:app=codex\x1b\\")

    def test_subagent_and_unknown_events_cannot_change_parent(self):
        for extra in [{"agent_id": "child"}, {"subagent_id": "child"}, {"source": "fork"}]:
            self.assertIsNone(reporter.report({"hook_event_name": "SessionStart", **extra}, {}))
        self.assertIsNone(reporter.report({"hook_event_name": "Stop", "session_id": "parent"}, {"CODEX_THREAD_ID": "child"}))
        self.assertIsNone(reporter.report({"hook_event_name": "Unknown"}, {}))
        self.assertIsNone(reporter.report([], {}))

    def test_compaction_does_not_look_idle(self):
        self.assertIn(b"state=working", reporter.report({"hook_event_name": "SessionStart", "source": "compact"}, {}))

    def test_late_command_completion_and_child_hooks_preserve_parent_state(self):
        previous = {"session_id": "parent", "event": "Stop", "turn_id": "turn-a", "state": "done"}
        payload = {"session_id": "parent", "hook_event_name": "PostToolUse", "turn_id": "turn-a"}
        message = reporter.report(payload, {})
        self.assertEqual(reporter.snapshot(payload, message, None, previous, 1000), previous)
        previous = {**previous, "event": "UserPromptSubmit", "turn_id": "turn-b", "state": "working"}
        self.assertEqual(reporter.snapshot(payload, message, None, previous, 1000), previous)
        self.assertEqual(reporter.snapshot({"hook_event_name": "SessionStart", "source": "fork"}, None, None, previous, 1000), previous)


if __name__ == "__main__":
    unittest.main()
