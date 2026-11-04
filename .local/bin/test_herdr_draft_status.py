import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("draft", Path(__file__).with_name("herdr-draft-status.py"))
draft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(draft)
rule = "─" * 30


def codex(body, footer="Context 10% used"):
    return "\x1b[2J\x1b[HComplete\r\n\r\n› " + body + "\r\n\r\n" + footer


def claude(body, footer="⏵⏵ auto mode on (shift+tab to cycle)"):
    return "\x1b[2J\x1b[HComplete\r\n" + rule + "\r\n❯\u00a0" + body + "\r\n" + rule + "\r\n" + footer


class DraftTests(unittest.TestCase):
    def test_codex_placeholder_and_real_draft(self):
        self.assertFalse(draft.detect_draft(codex("\x1b[2mAsk anything\x1b[0m", "Context 10% used\r\n? for shortcuts"), "codex"))
        self.assertTrue(draft.detect_draft(codex("Write tests"), "codex"))
        self.assertFalse(draft.detect_draft(codex("\x1b[2mAsk anything\x1b[0m"), "codex"))

    def test_rgb_components_are_not_faint_attributes(self):
        self.assertTrue(draft.detect_draft(codex("\x1b[38;2;2;22;0mDraft\x1b[0m"), "codex"))
        self.assertFalse(draft.detect_draft(codex("\x1b[2;38;5;22mPlaceholder\x1b[0m"), "codex"))

    def test_claude_nbsp_multiline_and_dim_placeholder(self):
        self.assertTrue(draft.detect_draft(claude("First line\r\nSecond line"), "claude"))
        self.assertFalse(draft.detect_draft(claude("\x1b[2mTry a command\x1b[22m"), "claude"))
        self.assertFalse(draft.detect_draft(claude(""), "claude"))

    def test_typed_control_phrases_do_not_become_menu_state(self):
        self.assertTrue(draft.detect_draft(claude("Explain esc to close and enter to select"), "claude"))
        self.assertTrue(draft.detect_draft(codex("Explain esc to close and enter to select"), "codex"))

    def test_dialog_and_historical_prompt_do_not_become_drafts(self):
        self.assertIsNone(draft.detect_draft(claude("1. Yes", "Enter to select · Esc to cancel"), "claude"))
        self.assertIsNone(draft.detect_draft("❯ Old question\r\nA response with no live composer", "claude"))
        self.assertIsNone(draft.detect_draft(codex("Old prompt", "Context 10% used · ↑/↓ to scroll"), "codex"))

    def test_repaint_erases_a_submitted_draft(self):
        paint = claude("Unsubmitted text")
        repaint = "\x1b[3;1H\x1b[2K❯\u00a0"
        self.assertFalse(draft.detect_draft(paint + repaint, "claude"))

    def test_observer_charset_reset_does_not_insert_a_phantom_draft(self):
        # The real core paint resets the character set before positioning its cursor.
        self.assertFalse(draft.detect_draft(claude("") + "\x1b[3;3H\x1b(B\x1b[?25h", "claude"))
        self.assertFalse(draft.detect_draft(claude("") + "\x1b[3;3H\x1b%G", "claude"))

    def test_pi_editor_is_anchored_to_context_footer(self):
        paint = "\x1b[H" + rule + "\r\nDraft\r\n" + rule + "\r\n~/repo\r\n0.1%/200k · model"
        self.assertTrue(draft.detect_draft(paint, "pi"))
        self.assertIsNone(draft.detect_draft(paint.replace("0.1%/200k · model", "enter to select"), "pi"))


if __name__ == "__main__": unittest.main()
