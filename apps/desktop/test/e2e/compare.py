"""Two runs of a drive, compared shot by shot.

A refactor that is meant to change nothing on screen is proved by the pixels being
the same pixels. Bytes first, because two identical PNGs are the same file; where
they differ the pixels are counted, because these drives have a noise floor of
their own and a handful of pixels at one edge is that, while a scrim painted a
different grey is every pixel over the note.

**Measure the floor before trusting a comparison.** Run a drive twice against the
same build and compare those two runs first: `shell.py` differs in about four of
its 83 shots and `access.py` in about fourteen of its 70, and one `access.py` shot
differs in bytes with zero pixels changed. A shot that differs by the same file and
the same magnitude as the floor is the floor.

    python apps/desktop/test/e2e/shell.py before
    python apps/desktop/test/e2e/shell.py before2
    python apps/desktop/test/e2e/compare.py shell/before shell/before2   # the floor
    # make the change, rebuild, then
    python apps/desktop/test/e2e/shell.py after
    python apps/desktop/test/e2e/compare.py shell/before shell/after

The names are folders under `shots/`, which is where every drive writes and which
is ignored: `shell/<tag>` for shell.py, `access/<label>` for access.py. Exits
non-zero when anything differs, so it can gate a loop; read the numbers rather
than the exit code when a floor is in play.

Needs Pillow, which is the only thing here that is not the standard library.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from PIL import Image, ImageChops

SHOTS = Path(__file__).resolve().parent / "shots"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pixels(one: Path, other: Path) -> tuple[int, int, int]:
    """How many pixels differ, out of how many, and by how much at the worst."""
    a = Image.open(one).convert("RGB")
    b = Image.open(other).convert("RGB")
    if a.size != b.size:
        return (a.size[0] * a.size[1], a.size[0] * a.size[1], 255)

    # A histogram rather than the pixels themselves: one pass in C over four million
    # of them instead of four million values through Python.
    counted = ImageChops.difference(a, b).convert("L").histogram()
    whole = a.size[0] * a.size[1]
    worst = max((value for value, held in enumerate(counted) if held), default=0)

    return (whole - counted[0], whole, worst)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    before, after = SHOTS / sys.argv[1], SHOTS / sys.argv[2]
    for run in (before, after):
        if not run.is_dir():
            print(f"no such run: {run}")
            return 2

    names = sorted({p.name for p in before.glob("*.png")} | {p.name for p in after.glob("*.png")})

    same = differ = missing = 0
    for name in names:
        one, other = before / name, after / name
        if not one.exists() or not other.exists():
            print(f"only in one run: {name}")
            missing += 1
        elif digest(one) == digest(other):
            same += 1
        else:
            differ += 1
            moved, whole, worst = pixels(one, other)
            share = 100 * moved / whole
            print(f"{name}: {moved} of {whole} pixels ({share:.3f}%), worst channel {worst}")

    print(f"{same} identical, {differ} differ, {missing} in one run only, of {len(names)}")
    return 1 if differ or missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
