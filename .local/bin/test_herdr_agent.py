import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("agent", Path(__file__).with_name("herdr-agent.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def assistant(id, *blocks, sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain, "timestamp": f"ts-{id}",
            "message": {"id": id, "role": "assistant", "content": [dict(b) for b in blocks]}}


def text(t): return {"type": "text", "text": t}
def tool(): return {"type": "tool_use"}
def prompt(t): return {"type": "user", "message": {"role": "user", "content": t}}
def result(): return {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result"}]}}


class Processes(unittest.TestCase):
    def test_descendants_follow_the_whole_tree(self):
        children = module.process_tree("10 1\n11 10\n12 11\n20 1\n")
        self.assertEqual(sorted(module.descendants(children, 10)), [10, 11, 12])

    def test_closest_refuses_ties_and_far_matches(self):
        self.assertEqual(module.closest([(1000, "a"), (9000, "b")], 1200), "a")
        self.assertIsNone(module.closest([(1000, "a"), (1300, "b")], 1150))
        self.assertIsNone(module.closest([(1000, "a")], 1000 + module.NEAR_MS + 1))


class ClaudeFinal(unittest.TestCase):
    rows = [prompt("review it"), assistant("m1", text("Looking.")), assistant("m1", tool()), result(),
            assistant("m2", text("Findings:")), assistant("m2", text("1. bug")),
            assistant("s1", text("subagent noise"), sidechain=True)]

    def test_done_takes_every_text_block_of_the_last_message(self):
        self.assertEqual(module.claude_final(self.rows, False), ("Findings:\n\n1. bug", "ts-m2"))

    def test_working_takes_the_turn_before_the_newest_prompt(self):
        rows = self.rows + [prompt("next task"), assistant("m3", text("Starting..."))]
        self.assertEqual(module.claude_final(rows, True)[0], "Findings:\n\n1. bug")

    def test_slash_commands_are_not_prompts(self):
        self.assertFalse(module.is_prompt(prompt("<command-name>/clear</command-name>")))
        self.assertTrue(module.is_prompt({"type": "user", "message": {"content": [text("hi")]}}))
        self.assertFalse(module.is_prompt(result()))


class OtherFinals(unittest.TestCase):
    def test_codex_uses_the_last_task_complete(self):
        rows = [{"type": "event_msg", "timestamp": "a", "payload": {"type": "task_complete", "last_agent_message": "old"}},
                {"type": "response_item", "payload": {"type": "message"}},
                {"type": "event_msg", "timestamp": "b", "payload": {"type": "task_complete", "last_agent_message": "new"}}]
        self.assertEqual(module.codex_final(rows, False), ("new", "b"))

    def test_pi_skips_tool_turns(self):
        rows = [{"type": "message", "timestamp": "a", "message": {"role": "assistant", "stopReason": "stop", "content": [text("answer")]}},
                {"type": "message", "timestamp": "b", "message": {"role": "assistant", "stopReason": "toolUse", "content": [text("calling")]}}]
        self.assertEqual(module.pi_final(rows, False), ("answer", "a"))


class Screen(unittest.TestCase):
    def test_wrapped_and_rendered_markdown_still_matches(self):
        message = "The **fix** is in `src/x.rs`: retry once, then fail loudly with the original error."
        screen = "⏺ The fix is in src/x.rs: retry once, then fail\n  loudly with the original error.\n\n❯ "
        self.assertTrue(module.on_screen(message, [screen]))
        self.assertFalse(module.on_screen(message, ["something else entirely"]))


class Identity(unittest.TestCase):
    entries = {"t4y": {"pids": [53652, 53703], "session": "c1", "place": "w / Claude"},
               "t17": {"pids": [92364], "session": "x9", "place": "e / Codex"}}

    def test_claude_pid_then_session_then_unknown(self):
        self.assertEqual(module.whoami({"CLAUDE_PID": "53703"}, self.entries), "t4y")
        self.assertEqual(module.whoami({"CODEX_THREAD_ID": "x9"}, self.entries), "t17")
        self.assertEqual(module.whoami({"HC_TERMINAL_ID": "t9"}, self.entries), "t9")
        self.assertIsNone(module.whoami({}, self.entries))

    def test_header_says_how_to_reply(self):
        self.assertEqual(module.header("t4y", "w / Claude"), '[from t4y — w / Claude · reply with: herdr-tell t4y "…"]')
        self.assertIn("no reply address", module.header(None, None))
        self.assertIn("don't herdr-tell", module.header("t4y", "w / Claude", waiting=True))


if __name__ == "__main__":
    unittest.main()
