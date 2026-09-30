"""The harness's own logic: how a scenario reads an answer, and how the fake agent reads
what nib says. Pure, so no app and no window.

    python -m unittest discover -s apps/desktop/test/agents -p "*_test.py"
"""

from __future__ import annotations

import json
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[3] / "scripts"))

from fake_agent import from_contract, marked_source  # noqa: E402
from run import ROADS, SCENARIOS, dotted, filled, judged, needed  # noqa: E402

#: Every kind of step run.py knows; a scenario with any other is a typo.
STEPS = {"call", "join", "record", "keyboard", "windows", "reader", "reader_eval", "hook", "pause", "observe"}

#: Every verb of the contract (agents/verbs.rs `NAMES`) and the window's agent verbs.
VERBS = {
    "browser_tabs", "browser_open", "browser_navigate", "browser_wait", "browser_snapshot",
    "browser_find", "browser_read", "browser_click", "browser_type", "browser_press",
    "browser_scroll", "browser_select", "browser_fill_form", "browser_hover", "browser_drag",
    "browser_upload", "browser_screenshot", "browser_console", "browser_network",
    "browser_evaluate", "browser_dialog", "browser_downloads", "browser_storage",
    "browser_close", "browser_show", "browser_takeover", "agent_status", "approval_status",
    "read_note", "edit_note",
}  # fmt: skip


class ReadingAnAnswer(unittest.TestCase):
    ASKED = {"status": "needs_approval", "approval": "a17", "summary": "Place order on shop.example", "ms": 4}
    SNAPPED = {"status": "ok", "ms": 7, "untrusted": "http://127.0.0.1/shop",
               "result": {"text": '- button "Place order" [ref=e12]', "matches": [{"ref": "e12"}]}}

    def test_a_path_reads_into_lists(self) -> None:
        self.assertEqual(dotted(self.SNAPPED, "result.matches.0.ref"), "e12")
        self.assertIsNone(dotted(self.SNAPPED, "result.matches.3.ref"))
        self.assertIsNone(dotted(self.SNAPPED, "result.nothing.here"))

    def test_the_status_is_the_first_thing_judged(self) -> None:
        self.assertIsNone(judged(self.ASKED, {"status": "needs_approval", "has": ["approval"]}))
        self.assertIn("needs_approval", str(judged(self.ASKED, {"status": "ok"})))

    def test_words_are_looked_for_as_they_are(self) -> None:
        self.assertIsNone(judged(self.SNAPPED, {"contains": {"result.text": 'button "Place order"'}}))
        self.assertIsNotNone(judged(self.SNAPPED, {"lacks": {"result.text": "place ORDER"}}))

    def test_words_from_a_page_must_come_back_marked(self) -> None:
        self.assertIsNone(judged(self.SNAPPED, {"untrusted": True}))
        self.assertIsNotNone(judged({**self.SNAPPED, "untrusted": None}, {"untrusted": True}))

    def test_one_of_passes_on_any(self) -> None:
        either = {"one_of": [{"status": "error", "code": "limit"}, {"status": "ok", "slower_than_ms": 1000}]}
        self.assertIsNone(judged({"status": "error", "code": "limit", "ms": 3}, either))
        self.assertIsNone(judged({"status": "ok", "ms": 1500}, either))
        self.assertIsNotNone(judged({"status": "ok", "ms": 20}, either))

    def test_names_are_put_in_whole_or_inside_words(self) -> None:
        names = {"site": "http://127.0.0.1:1", "tab": "a3", "flag": True}
        step = {"args": {"url": "{site}/shop", "tab": "{tab}", "on": "{flag}", "left": "{unknown}"}}
        self.assertEqual(
            filled(step, names),
            {"args": {"url": "http://127.0.0.1:1/shop", "tab": "a3", "on": True, "left": "{unknown}"}},
        )


class ReadingWhatNibSays(unittest.TestCase):
    def test_the_contracts_answer_is_kept(self) -> None:
        said = from_contract({"status": "error", "code": "site_denied", "message": "no"}, 3.14)
        self.assertEqual((said["status"], said["code"], said["ms"]), ("error", "site_denied", 3.1))

    def test_the_windows_answer_is_read_as_one(self) -> None:
        self.assertEqual(from_contract({"ok": True, "value": 4}, 1)["result"], 4)
        self.assertEqual(from_contract({"ok": False, "error": "no such note"}, 1)["status"], "error")

    def test_a_verb_the_window_has_not_got_is_missing_not_failed(self) -> None:
        self.assertEqual(from_contract({"ok": False, "error": "there is no verb called browser_open"}, 1)["status"], "missing")

    def test_the_mark_says_where_the_words_came_from(self) -> None:
        self.assertEqual(marked_source('<untrusted source="https://a.example/x">hi</untrusted>'), "https://a.example/x")
        self.assertIsNone(marked_source("nothing marked"))


class EveryScenario(unittest.TestCase):
    """Each file read the way run.py reads it, so a typo is found here rather than on a
    probe build at night."""

    def test_is_steps_of_known_kinds_and_verbs_of_the_contract(self) -> None:
        files = sorted(SCENARIOS.glob("*.json"))
        self.assertGreater(len(files), 10)
        for path in files:
            with self.subTest(scenario=path.stem):
                scenario = json.loads(path.read_text(encoding="utf-8"))
                self.assertTrue(scenario.get("proves"), "says what it proves")
                self.assertTrue(scenario.get("doc"), "names the sections it proves")
                for step in scenario["steps"]:
                    self.assertEqual(len(STEPS & step.keys()), 1, step)
                self.assertLessEqual(set(needed(scenario)), VERBS)
                for road in scenario.get("via", []):
                    self.assertIn(road, ROADS)


if __name__ == "__main__":
    unittest.main()
