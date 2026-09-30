"""HTML inside a note, photographed: a raw block, an inline tag, an ``html`` fence.

Raw HTML blocks and inline tags are part of nib's markdown, and the grammar that
colours them used to be in front of the first paint: `@codemirror/lang-markdown`
imports `@codemirror/lang-html` outright, which drags the CSS and JavaScript grammars
in with it and the parser runtime under all three - a hundred and sixty-seven
kilobytes for the sake of the notes that have a tag in them. It arrives with the first
tag now, the way a fence's language does; see packages/lang-html.

So this drive is the proof that nothing about the colouring changed. It photographs
the three places HTML can appear in a note, twice over, and the two sets of PNGs are
compared byte for byte:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

and, from a tree without the change in it, the same again into a folder of its own:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive \
        --outDir dist-before

Then, from the repository root, once for each build:

    python apps/desktop/test/e2e/html-in-notes.py before dist-before
    python apps/desktop/test/e2e/html-in-notes.py after dist

Shots go beside this file under `shots/html-in-notes/<tag>/`, which is ignored. It
counts the coloured spans in each region as well as photographing it, because a grey
region and a coloured one are two different pictures but only one of them is a
regression, and a count says which.

It types a tag too, because auto-closing one is the only thing the HTML support
brings a note beyond the colours: `<em>` typed inside a raw block closes itself.
"""

from __future__ import annotations

import sys
from pathlib import Path

from harness import Drive

#: A run is one tag's folder, and the other tag's is what it is compared with.
DRIVE = Drive(__file__, fresh=False)
say = DRIVE.say
ORIGIN = DRIVE.origin


DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# The three places HTML appears in a note. The raw block carries a `<style>` and a
# `<script>` because those are parsed by the CSS and JavaScript grammars nested
# inside the HTML one, which is the rest of what used to be eager.
BLOCK = """# A raw block

<div class="card" data-kind="note">
  <p>A kestrel <em>hangs</em> on the wind.</p>
  <style>.card { color: teal; border: 1px solid }</style>
  <script>const wind = 12; console.log("knots", wind)</script>
</div>

<!-- and a comment block -->

After the block.
"""

INLINE = """# An inline tag

The wind was <u>steady</u> all week, and <strong>cold</strong> with it.

A <span class="tint">tinted</span> word, and an <abbr title="knots">kn</abbr>.
"""

FENCE = """# A fence

```html
<section id="field">
  <h2>Field notes</h2>
  <img src="kestrel.png" alt="A kestrel">
</section>
```

After the fence.
"""

TYPING = """# Typing

<div>
  <p>Wind</p>
"""

NOTES = [("block", BLOCK), ("inline", INLINE), ("fence", FENCE)]

# The colouring as a number: how many spans the highlighter painted inside the note
# and how many characters are under them. A region whose grammar never arrived has
# none of either, which is a different picture and the same file size.
COLOURED = """
() => {
  const painted = [...document.querySelectorAll('.cm-content span[class]')].filter(
    (one) => !/(^|\\s)cm-/.test(one.className),
  )
  return {
    spans: painted.length,
    letters: painted.reduce((sum, one) => sum + one.textContent.length, 0),
  }
}
"""

OPEN = """async (text) => {
  const ws = window.nibApp.workspace
  const path = await ws.noteFrom(text)
  if (path) await ws.openEntry(path, { activate: true })
}"""


def drive(browser, out: Path, scheme: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    context = browser.new_context(
        viewport={"width": 1280, "height": 860},
        user_agent=DESKTOP_AGENT,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{scheme}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(400)

    def shot(tag: str) -> None:
        box = page.locator(".cm-content").first.bounding_box()
        if not box:
            say(f"[{scheme}] no editor for {tag}")
            return
        page.screenshot(
            path=str(out / f"{scheme}-{tag}.png"),
            clip={
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": min(520, 860 - box["y"]),
            },
        )
        say(f"shot {scheme}-{tag}.png")

    for name, text in NOTES:
        page.evaluate(OPEN, text)
        # Long enough for the grammar to arrive and the region to be parsed again:
        # it is a fetch off the same server the page came from.
        page.wait_for_timeout(1800)
        say(f"[{scheme}] {name}: {page.evaluate(COLOURED)}")
        shot(name)

    # The one behaviour beyond the colours: a tag typed inside a raw block closes
    # itself. The caret goes at the end of the line inside the block - a blank line
    # would end the block, CommonMark being what it is - and `<em>` typed there comes
    # back as `<em></em>`. The block's own closing tag is deliberately not below it: a
    # tag something else already closes is left alone.
    page.evaluate(OPEN, TYPING)
    page.wait_for_timeout(1600)
    page.evaluate(
        """() => {
          const view = window.nib
          view.dispatch({ selection: { anchor: view.state.doc.line(4).to } })
          view.focus()
        }"""
    )
    page.keyboard.type("<em>")
    page.wait_for_timeout(700)
    say(f"[{scheme}] typed: {page.evaluate('() => window.nib.state.doc.toString()')!r}")
    shot("typed")

    context.close()


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"
    out = DRIVE.shots / tag
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, out, scheme)

    return DRIVE.verdict(f"shots in {out}")


if __name__ == "__main__":
    raise SystemExit(main())
