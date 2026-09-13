"""What a page has to have stopped doing before its picture is worth keeping.

Not a drive: the four things a drive that photographs the app does before every
shot, in one place, because two of them do it and the next one will want to.

`shell.py` went from ten of its 83 shots differing between two runs of one build -
one of them by more than half its pixels - to none at all, and every one of the
four was needed:

  - motion reduced, on the context. A sheet caught half way through its slide is a
    different picture from the same sheet. What the motion looks like is
    touch-move.py and motion.test.ts, which are about exactly that;
  - the caret hidden. It blinks, so the picture of it depends on the millisecond
    the shot was taken at. Both states are still, so nothing that waits can help;
  - the page asked whether it has finished what it declared: the faces, every
    transition and keyframe `getAnimations` knows about, and the overlay scrollbar,
    which is lit while a surface is scrolled and dims on a timer of its own;
  - and the same picture twice running, which catches what the page never declared
    at all - a face that arrived between the two, an image decoding, a shadow
    settling.

Imported by name, which works because Python puts a script's own folder first on
the path: `from settling import quiet, steady, NO_CARET`.
"""

from __future__ import annotations

from collections.abc import Callable

#: What the page must have finished before a shot is taken.
#:
#: The faces first: a shot taken while a face is still arriving is a shot of the
#: fallback, and the two differ by every glyph on the screen. Then the animations,
#: asked of the browser itself rather than guessed at with a sleep - `getAnimations`
#: knows about every transition and keyframe on the page, including the ones a
#: component started a moment ago.
#:
#: And the overlay scrollbar, which dims on a timer after a surface is scrolled, so
#: whether it is in the picture depends on how long the step before took. Both of
#: its states are still, which is why two matching frames do not catch it: one run
#: had it dim before the first frame and the next had it dim after the second. It is
#: a class, so it can be waited for.
STILL = """
() => document.fonts.status === 'loaded'
  && document.getAnimations().every((one) => one.playState !== 'running')
  && !document.querySelector('.nib-scrollbar.is-lit, .nib-scrollbar.is-settling')
"""

#: The caret, hidden. Both spellings: the browser's own in a field, and the
#: editor's, which is an element with a blink of its own.
NO_CARET = """
  *, *::before, *::after { caret-color: transparent !important }
  .cm-cursor, .cm-cursorLayer, .cm-dropCursor { visibility: hidden !important }
"""

#: The script that puts that stylesheet in. A statement rather than a function,
#: because an init script is run as a script and a bare arrow expression is an arrow
#: expression nobody called.
HIDE_CARET = (
    "document.addEventListener('DOMContentLoaded', function () {"
    " var style = document.createElement('style');"
    f" style.textContent = {NO_CARET!r};"
    " document.head.appendChild(style) })"
)


#: Which element has the keyboard, as something two samples can be compared by.
FOCUS = """
() => {
  const one = document.activeElement
  if (!one) return 'none'
  return `${one.tagName}.${one.className}#${one.id}[${one.getAttribute('aria-label') ?? ''}]`
}
"""


def quiet(page: object, settle: int = 90) -> None:
    """Waits until nothing the page declared is still moving, and the keyboard has
    stopped moving with it.

    The focus is the third thing of this kind, after the animations and the
    scrollbar: a sheet puts the keyboard somewhere when it opens, and where it puts
    it is not always reached before the first shot. Both runs are then still and the
    two disagree by a focus ring - which was the last of `access.py`'s shots to
    differ between two runs of one build, four hundred pixels round a close button
    in one and round a back button in the other.

    A predicate cannot say it, because "has not changed" needs two readings. So it is
    two readings.
    """
    try:
        page.wait_for_function(STILL, timeout=6000)  # type: ignore[attr-defined]
    except Exception:
        # A page with an animation that never ends - a spinner - is photographed as
        # it is rather than waited on for ever; the shot says so by being unsteady.
        pass

    was = page.evaluate(FOCUS)  # type: ignore[attr-defined]
    for _ in range(8):
        page.wait_for_timeout(settle)  # type: ignore[attr-defined]
        now = page.evaluate(FOCUS)  # type: ignore[attr-defined]
        if now == was:
            return
        was = now


def steady(
    page: object,
    take: Callable[[], bytes],
    said: Callable[[str], None] | None = None,
    what: str = "",
    tries: int = 8,
) -> bytes:
    """The same picture twice running, which is a surface that has stopped.

    Two shots that match byte for byte are a page that did not move between them,
    whatever it was doing. Eight tries, and then whatever it is doing it is doing
    for ever - which is said out loud rather than waited on, because a drive that
    hangs is worse than a shot that wobbles.
    """
    quiet(page)

    last = take()
    for _ in range(tries):
        page.wait_for_timeout(60)  # type: ignore[attr-defined]
        now = take()
        if now == last:
            return now
        last = now

    if said:
        said(f"{what} never held still".strip())

    return last
