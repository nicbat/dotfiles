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


class BackgroundShellTests(unittest.TestCase):
    footer = "\n\n\n› \x1b[2mAsk Codex to do anything\x1b[0m\n\nGPT-6 · Context 42% used\n? for shortcuts"
    one = "1 background terminal running · /ps to view · /stop to close"

    def test_codex_live_footer_boundaries_from_legacy_adapter(self):
        for name, prefix, count in [
            ("one", "Output\n\n" + self.one, 1),
            ("many", "2 background terminals running · /ps to view · /stop to close", 2),
            ("wrapped", "2 background terminals running · /ps to view ·\n/stop to close", 2),
            ("working", "• Working (1m · esc to interrupt) · " + self.one, 1),
            ("working tip", "• Working (1m • esc to interrupt) · " + self.one + "\nTip: Try a shorter prompt.", 1),
            ("clipped help", "1 background terminal running · /ps to", 1),
            ("clipped noun", "1 backg", None),
            ("wrong plural", "1 background terminals running · /ps to view · /stop to close", None),
            ("unexpected suffix", self.one + " quoted", None),
            ("unreasonable", "10001 background terminals running", None),
            ("quoted", "• Example: " + self.one, None),
            ("historical", "• Example: " + self.one + "\n\n• Finished.", 0),
            ("finished", "• Finished.", 0),
            ("working hidden", "• Working (1m · esc to interrupt)", None),
        ]:
            with self.subTest(name=name):
                self.assertEqual(draft.background_shells(prefix + self.footer, "codex"), count)

    def test_codex_drafts_and_views_keep_counts_separate(self):
        raw = self.one + self.footer.replace("\x1b[2mAsk Codex to do anything\x1b[0m", "Draft").replace("? for shortcuts", "tab to queue message")
        self.assertTrue(draft.detect_draft(raw, "codex"))
        self.assertEqual(draft.background_shells(raw, "codex"), 1)
        for suffix in ["\nEsc to close", "\n↑/↓ to scroll", "\npgup/pgdn"]:
            self.assertIsNone(draft.background_shells(self.one + self.footer + suffix, "codex"))
        self.assertIsNone(draft.background_shells(self.one, "codex"))
        typed = "Complete" + self.footer.replace("\x1b[2mAsk Codex to do anything\x1b[0m", self.one)
        self.assertEqual(draft.background_shells(typed, "codex"), 0)

    def test_collapsed_question_preserves_explicit_count_without_inventing_zero(self):
        question = "\n\n• Queued follow-up inputs\n? 1 question\nshift+← to answer"
        self.assertEqual(draft.background_shells(self.one + question + self.footer, "codex"), 1)
        self.assertIsNone(draft.background_shells(question + self.footer, "codex"))
        expanded = "• Queued follow-up inputs\n\nWhich option?\n\nType your answer\n\nenter submit   ctrl+] skip   shift+→ main prompt"
        self.assertEqual(draft.background_shells(self.one + "\n\n" + expanded, "codex"), 1)
        self.assertIsNone(draft.background_shells(expanded, "codex"))
        # Control words inside the composer do not turn it into a question view.
        self.assertEqual(draft.background_shells(self.one + self.footer.replace("Ask Codex to do anything", "enter submit ctrl+] skip shift+→ main prompt"), "codex"), 1)

    def test_claude_controls_wrapping_and_custom_status_from_legacy_adapter(self):
        for footer, count in [
            ("⏵⏵ auto mode on · 1 shell · ← for agents", 1),
            ("⏵⏵ auto mode on · 2 agents · 3 shells · ← for agents", 3),
            ("1 shell · ← for agents", 1),
            ("⏵⏵ auto mode on · 2 shells\n· ← for agents", 2),
            ("⏵⏵ auto mode on · 2\nshells · ← for agents", 2),
            ("⏵⏵ auto mode\non · 2 shells · ← for agents", 2),
            ("2 shells\n· ← for agents", 2),
            ("⏵⏵ auto mode on · 2 shells · ← for", 2),
            ("⏵⏵ auto mode on · 2 shel", None),
            ("2 shells\n⏵⏵ auto mode on · ← for agents", None),
            ("1 shell · 2 shells · ← for agents", None),
            ("1 shells · ← for agents", None),
            ("2 shell · ← for agents", None),
            ("10001 shells · ← for agents", None),
            ("1 shell still running · ← for agents", None),
            ("⏵⏵ auto mode on (shift+tab to cycle)", None),
            ("⏵⏵ auto mode on · 2 shells · ← for agents\nEnter to select · Esc to cancel", None),
            ("⏵⏵ auto mode on · 2 shells · ← for agents\nshowing detailed transcript", None),
        ]:
            with self.subTest(footer=footer):
                self.assertEqual(draft.background_shells(claude("", footer), "claude"), count)

    def test_claude_counts_ignore_history_input_and_retained_panel(self):
        self.assertIsNone(draft.background_shells(claude("1 shell · ← for agents"), "claude"))
        self.assertIsNone(draft.background_shells("1 shell still running\n" + claude(""), "claude"))
        footer = "⏵⏵ auto mode on · 2 shells · ← for agents\n\n⏺ main\n" + "◯ helper Finished\n" * 12
        self.assertEqual(draft.background_shells(claude("Draft", footer), "claude"), 2)
        self.assertIsNone(draft.background_shells(claude("", "1 shell · ← for agents"), "pi"))


if __name__ == "__main__": unittest.main()
