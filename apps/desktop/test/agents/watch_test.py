"""The family watch in scripts/probe_app.py, decided over numbers.

Never by putting a real window on a screen to see whether it is caught: that would be the
very thing the watch exists to stop. So every window and every screen here is a rectangle
in a list, and the loop itself runs against a desktop that is only this file's.

    python -m unittest discover -s apps/desktop/test/agents -p "*_test.py"
"""

from __future__ import annotations

import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4] / "scripts"))

import probe_app  # noqa: E402 - the path above is what finds it
from probe_app import Look, Seen, descendants, in_view, on_a_screen  # noqa: E402

APP = 100
ENGINE = 200
RENDERER = 300
SOMEBODY = 900

#: One screen at 200 %, 2944 by 1840 of its own pixels: this machine's.
LAPTOP = (0, 0, 2944, 1840)
#: A screen to its left, which puts it at negative coordinates.
LEFT = (-2560, 0, 0, 1440)
#: And one above the laptop.
ABOVE = (0, -2160, 3840, 0)


def window(hwnd: int, pid: int, box: tuple[int, int, int, int], kind: str = "Chrome_WidgetWin_1", visible: bool = True) -> Seen:
    return Seen(hwnd=hwnd, pid=pid, kind=kind, visible=visible, box=box)


def desk(*windows: Seen, front: int = 0, screens: tuple[tuple[int, int, int, int], ...] = (LAPTOP,)) -> Look:
    return Look(windows=windows, front=front, screens=screens)


FAMILY = {APP, ENGINE, RENDERER}


class WhatIsInView(unittest.TestCase):
    def test_a_window_on_a_screen_is(self) -> None:
        seen = in_view(desk(window(1, ENGINE, (200, 300, 680, 820))), FAMILY)
        self.assertEqual(len(seen), 1)
        self.assertIn("on a screen at 200,300 480x520", seen[0])

    def test_one_off_every_screen_is_not(self) -> None:
        self.assertEqual(in_view(desk(window(1, APP, (-32000, -32000, -29640, -30400))), FAMILY), [])

    def test_the_window_in_front_is_wherever_it_is(self) -> None:
        seen = in_view(desk(window(7, APP, (-32000, -32000, -31000, -31000)), front=7), FAMILY)
        self.assertEqual(len(seen), 1)
        self.assertIn("window in front", seen[0])

    def test_the_three_at_once_are_two(self) -> None:
        look = desk(
            window(1, ENGINE, (100, 100, 400, 400)),
            window(2, RENDERER, (-40000, -40000, -39000, -39000)),
            window(3, APP, (-32000, -32000, -31000, -31000)),
            front=3,
        )
        seen = in_view(look, FAMILY)
        self.assertEqual(len(seen), 2)
        self.assertTrue(any("0x1 " in one for one in seen))
        self.assertTrue(any("0x3 " in one for one in seen))

    def test_somebody_elses_window_is_theirs(self) -> None:
        look = desk(window(1, SOMEBODY, (0, 0, 800, 600)), front=1)
        self.assertEqual(in_view(look, FAMILY), [])

    def test_a_hidden_window_on_a_screen_is_not(self) -> None:
        look = desk(window(1, ENGINE, (0, 0, 800, 600), visible=False))
        self.assertEqual(in_view(look, FAMILY), [])

    def test_a_window_with_no_area_is_not(self) -> None:
        look = desk(window(1, ENGINE, (10, 10, 10, 400)), window(2, ENGINE, (10, 10, 400, 10)))
        self.assertEqual(in_view(look, FAMILY), [])

    def test_the_windows_kept_for_messages_are_not(self) -> None:
        look = desk(
            window(1, APP, (0, 0, 13, 13), kind="Tao Thread Event Target"),
            window(2, APP, (0, 0, 13, 13), kind="ch.emilvinu.nib.probe.x-sic"),
        )
        self.assertEqual(in_view(look, FAMILY), [])

    def test_but_even_one_of_those_in_front_is(self) -> None:
        look = desk(window(1, APP, (0, 0, 13, 13), kind="Tao Thread Event Target"), front=1)
        self.assertEqual(len(in_view(look, FAMILY)), 1)

    def test_a_screen_left_of_the_primary_one_counts(self) -> None:
        popup = window(1, ENGINE, (-1500, 200, -1100, 500))
        self.assertEqual(in_view(desk(popup), FAMILY), [])
        self.assertEqual(len(in_view(desk(popup, screens=(LAPTOP, LEFT)), FAMILY)), 1)

    def test_and_one_above_it(self) -> None:
        popup = window(1, ENGINE, (300, -900, 700, -400))
        self.assertEqual(len(in_view(desk(popup, screens=(LAPTOP, ABOVE)), FAMILY)), 1)

    def test_one_pixel_over_an_edge_is_on_it(self) -> None:
        self.assertTrue(on_a_screen((-400, 0, 1, 20), [LAPTOP]))
        self.assertFalse(on_a_screen((-400, 0, 0, 20), [LAPTOP]))
        self.assertTrue(on_a_screen((2943, 1839, 3000, 1900), [LAPTOP]))
        self.assertFalse(on_a_screen((2944, 0, 3000, 20), [LAPTOP]))


class TheAgentPageAtEveryScale(unittest.TestCase):
    """docs/agent-native.md 3 and 6.5: an agent's page sits 10,000 CSS pixels up and left
    of the window's corner. In the screen's own pixels that is 10,000 times the scale, so
    the question is whether any desk anybody has reaches it at 100, 150 or 200 %."""

    DESKS = {
        "one laptop": (LAPTOP,),
        "a screen to the left": (LAPTOP, LEFT),
        "three 4K screens to the left at 100 %": (LAPTOP, (-3840, 0, 0, 2160), (-7680, 0, -3840, 2160), (-11520, 0, -7680, 2160)),
        "a screen above and one to the left": (LAPTOP, LEFT, ABOVE),
        "four screens stacked above": tuple((0, -2160 * n, 3840, -2160 * (n - 1)) for n in range(1, 5)),
    }

    def test_no_desk_reaches_it(self) -> None:
        for scale in (1.0, 1.5, 2.0):
            for corner in ((0, 0), (120, 80), (-2400, 200), (-32000 * scale, -32000 * scale)):
                left = round(corner[0] - 10000 * scale)
                top = round(corner[1] - 10000 * scale)
                page = (left, top, left + round(1280 * scale), top + round(800 * scale))
                for name, screens in self.DESKS.items():
                    with self.subTest(scale=scale, corner=corner, desk=name):
                        self.assertFalse(on_a_screen(page, screens))

    def test_while_a_page_at_the_windows_own_corner_would_be(self) -> None:
        # The control: the same page with no offset is on the laptop at every scale, so
        # the test above is about the offset and not about a broken rectangle.
        for scale in (1.0, 1.5, 2.0):
            page = (120, 80, 120 + round(1280 * scale), 80 + round(800 * scale))
            self.assertTrue(on_a_screen(page, (LAPTOP,)))


class TheFamily(unittest.TestCase):
    def test_every_process_under_the_app(self) -> None:
        parents = {APP: 1, ENGINE: APP, RENDERER: ENGINE, SOMEBODY: 4}
        born = {APP: 10, ENGINE: 11, RENDERER: 12, SOMEBODY: 1}.get
        self.assertEqual(descendants(APP, parents, born), FAMILY)

    def test_not_one_whose_dead_parent_had_the_apps_number(self) -> None:
        # Explorer's parent ended long ago; the app has been handed that number since.
        parents = {APP: 1, ENGINE: APP, SOMEBODY: APP}
        born = {APP: 10, ENGINE: 11, SOMEBODY: 2}.get
        self.assertEqual(descendants(APP, parents, born), {APP, ENGINE})

    def test_nor_one_that_cannot_say_when_it_started(self) -> None:
        parents = {APP: 1, ENGINE: APP}
        self.assertEqual(descendants(APP, parents, {APP: 10}.get), {APP})

    def test_a_loop_in_the_table_ends(self) -> None:
        parents = {APP: RENDERER, ENGINE: APP, RENDERER: ENGINE}
        born = {APP: 10, ENGINE: 11, RENDERER: 12}.get
        self.assertEqual(descendants(APP, parents, born), FAMILY)


class FakeApp:
    """A process that runs for `lives` looks and then ends."""

    def __init__(self, lives: int) -> None:
        self.pid = APP
        self.lives = lives

    def poll(self) -> int | None:
        self.lives -= 1
        return None if self.lives >= 0 else 0


class TheLoop(unittest.TestCase):
    """`_watch` against a desktop of this file's: what it ends, and how it leaves."""

    def run_watch(self, looks: list[Look], lives: int, living: dict[int, int]) -> tuple[list[list[int]], BaseException | None]:
        ended: list[list[int]] = []
        stream = iter(looks)
        last = looks[-1]
        born = {APP: 10, ENGINE: 11, RENDERER: 12}.get
        with (
            mock.patch.object(probe_app, "look", lambda of=None: next(stream, last)),
            mock.patch.object(probe_app, "parents", lambda: dict(living)),
            mock.patch.object(probe_app, "born", born),
            mock.patch.object(probe_app, "end_all", lambda pids: ended.append(sorted(pids))),
            mock.patch.object(probe_app, "in_physical_pixels", lambda: None),
            mock.patch.object(probe_app.time, "sleep", lambda _s: None),
            mock.patch.object(probe_app.os, "_exit", side_effect=SystemExit(probe_app.IN_VIEW_EXIT)),
            mock.patch.object(probe_app.sys, "stderr"),
        ):
            try:
                probe_app._watch(FakeApp(lives))  # type: ignore[arg-type]
            except SystemExit as leaving:
                return ended, leaving
        return ended, None

    def test_a_renderers_window_on_a_screen_ends_the_whole_family_with_3(self) -> None:
        quiet = desk(window(1, APP, (-32000, -32000, -31000, -31000)))
        popup = desk(window(1, APP, (-32000, -32000, -31000, -31000)), window(2, RENDERER, (0, 0, 300, 200)))
        living = {APP: 1, ENGINE: APP, RENDERER: ENGINE}
        ended, leaving = self.run_watch([quiet, quiet, popup], lives=50, living=living)
        self.assertEqual(ended, [[APP, ENGINE, RENDERER]])
        self.assertIsNotNone(leaving)
        assert leaving is not None
        self.assertEqual(getattr(leaving, "code", None), 3)

    def test_a_quiet_run_ends_when_the_app_does(self) -> None:
        quiet = desk(window(1, APP, (-32000, -32000, -31000, -31000)))
        ended, leaving = self.run_watch([quiet], lives=5, living={})
        self.assertEqual(ended, [])
        self.assertIsNone(leaving)

    def test_an_engine_that_outlives_the_app_is_still_watched(self) -> None:
        quiet = desk()
        late = desk(window(2, ENGINE, (40, 40, 400, 300)))
        # The engine is found while the app runs, and its window arrives after the app ended.
        looks = [quiet] * 30 + [late]
        living = {ENGINE: APP}
        with mock.patch.object(probe_app, "descendants", lambda root, parents, born: {APP, ENGINE}):
            ended, leaving = self.run_watch(looks, lives=3, living=living)
        self.assertEqual(ended, [[APP, ENGINE]])
        self.assertIsNotNone(leaving)


if __name__ == "__main__":
    unittest.main()
