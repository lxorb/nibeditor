import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The marks across the top of the app, and the one shape each of them has.
 *
 *  Four small things Emil saw in one screenshot, and every one of them is a rule
 *  that was said in more than one place or in no place at all:
 *
 *  - a space was named without the mark it wears everywhere else it is named;
 *  - a mark inside a badge sat a pixel low, because an `svg` is an inline element
 *    and inherits a line box it does not fit in;
 *  - "shared" was a dot in the accent, which is also the shape of the dot that
 *    means "not written down yet";
 *  - the sidebar button faded half its glyph away, so it was one drawing shut and
 *    a different one open.
 *
 *  Where the pixels themselves are checked is apps/desktop/test/e2e/shell-polish.py,
 *  which measures them in a real browser. What is here is the rule behind each of
 *  them, so a future component cannot restate it differently. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

interface Component {
  name: string
  text: string
  style: string
}

const components: Component[] = componentFiles(SOURCE).map((path) => {
  const text = readFileSync(path, 'utf8')
  return {
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    text,
    style: [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1]).join('\n'),
  }
})

function named(name: string): Component {
  const found = components.find((one) => one.name === name)
  if (!found) throw new Error(`${name} is not there any more`)
  return found
}

/** A stylesheet without its comments: a note about a dot is not a dot. */
function declarations(style: string): string {
  return style.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('a mark that fills the box it was given', () => {
  /** The one that was wrong. An `svg` is inline by default, so it sits on the
   *  text baseline of whatever wraps it, and a 16px mark inside a 21.6px line box
   *  is pushed down by the descender under it. */
  test('is taken out of the line box it would otherwise sit in', () => {
    const style = declarations(named('lib/Icon.svelte').style)
    const glyph = /\.glyph\s*\{([^}]*)\}/.exec(style)?.[1] ?? ''

    expect(glyph).toMatch(/display\s*:\s*block/)
    expect(glyph).toMatch(/width\s*:\s*100%/)
    expect(glyph).toMatch(/height\s*:\s*100%/)
  })

  test('and the space named in the title bar wears one', () => {
    const bar = named('lib/Titlebar.svelte')
    expect(bar.text).toContain("import SpaceMark from './SpaceMark.svelte'")
    // In the badge every other surface puts it in, rather than loose beside the
    // word: a letter with no badge around it reads as part of the name.
    expect(bar.text).toMatch(/class="nib-badge"[\s\S]{0,200}<SpaceMark/)
  })

  /** And the header over the file list, which is the list of spaces shut. Both
   *  places the switcher names a space render one badge written once, rather than
   *  two that look alike: a mark the header drew for itself is a second design for
   *  the same object, and it drifts. See docs/design.md. */
  test('and so does the space named over the file list, out of the one badge', () => {
    const switcher = named('lib/SpaceSwitcher.svelte')

    expect(switcher.text).toMatch(/\{#snippet badge\(/)
    expect(switcher.text.match(/<SpaceMark /g)).toHaveLength(1)
    expect(switcher.text).toMatch(/class="nib-badge"[\s\S]{0,200}<SpaceMark/)
    // Rendered twice: by the row for each space in the list, and by the mark the
    // header wears - which the header itself asks for in both of its states, the
    // name read and the name being typed.
    expect(switcher.text.match(/\{@render badge\(/g)).toHaveLength(2)
    expect(switcher.text.match(/\{@render mark\(\)/g)).toHaveLength(2)
  })
})

describe('the mark that says shared', () => {
  test('is drawn in one component and nowhere else', () => {
    const drawn = components
      .filter((one) => /lucide\/dist\/esm\/icons\/(users|share-2)\.mjs/.test(one.text))
      .map((one) => one.name)

    expect(drawn).toEqual(['lib/SharedMark.svelte'])
  })

  test('is small and quiet, which is what a mark beside a name is', () => {
    const style = declarations(named('lib/SharedMark.svelte').style)
    expect(style).toMatch(/color\s*:\s*var\(--muted\)/)
    expect(style).toMatch(/width\s*:\s*var\(--icon-sm\)/)
  })

  test('and says it in a word as well, for a reader who cannot see it', () => {
    expect(named('lib/SharedMark.svelte').text).toMatch(/aria-label=\{label\}/)
    expect(named('lib/SharedMark.svelte').text).toMatch(/t\('Shared'\)/)
  })

  test('and nothing draws a dot for it any more', () => {
    // A round few pixels filled with the accent is the shape it had. Three
    // surfaces still draw one, and none of the three is about other people:
    // the tab's saving dot, which is what a dot means from now on; the pulse on
    // a request waiting to be let in; and the foot's sync light. The switcher,
    // which is where the shared dot was, is not among them.
    const dots = components
      .filter((one) => {
        const style = declarations(one.style)
        return [...style.matchAll(/\{([^}]*)\}/g)].some((rule) => {
          const body = rule[1] ?? ''
          return (
            /border-radius\s*:\s*50%/.test(body) &&
            /background\s*:\s*var\(--accent\)/.test(body) &&
            /width\s*:\s*[0-9]px/.test(body)
          )
        })
      })
      .map((one) => one.name)
      .sort()

    expect(dots).toEqual(['lib/JoinSheet.svelte', 'lib/SidebarFoot.svelte', 'lib/Tabs.svelte'])
  })

  test('and the file list says it on the note itself', () => {
    const tree = named('lib/Tree.svelte')
    expect(tree.text).toContain("import SharedMark from './SharedMark.svelte'")
    // Twice, on the one row the list draws: every row is a note, and there are
    // two things the one mark says about the note it opens - somebody is in it
    // right now, or it is a file shared on its own. One shape for both, because it
    // is the same fact about other people, and a second drawing of it is how one
    // design becomes two. See docs/tree.md.
    expect(tree.text.match(/<SharedMark /g)).toHaveLength(2)
    expect(tree.text).toContain('othersIn(')
    expect(tree.text).toContain('isSharedItem(')
  })

  test('and the switcher says it with the mark instead', () => {
    const switcher = named('lib/SpaceSwitcher.svelte')
    expect(switcher.text).toContain("import SharedMark from './SharedMark.svelte'")
    // Both places a space is named in the panel: the row in the list of them, and
    // the header over the file list, which is that list shut.
    expect(switcher.text.match(/<SharedMark \/>/g)).toHaveLength(2)
    // And the dot it used to draw is gone rather than merely unused.
    expect(declarations(switcher.style)).not.toMatch(/\.with\b/)
  })
})

describe('the sidebar button', () => {
  test('is one glyph, drawn one way in both states', () => {
    const style = declarations(named('lib/SidebarToggle.svelte').style)
    const edge = [...style.matchAll(/\.edge\s*\{([^}]*)\}|\.edge[^{]*\{([^}]*)\}/g)]
      .map((one) => one[1] ?? one[2] ?? '')
      .join(';')

    // Nothing about the edge changes with the state. An opacity that went to
    // nothing turned one drawing into two - a plain window shut, a split panel
    // open - and so did sliding it into the frame's own border, which is what it
    // was reported as the second time. The state is said in words instead.
    expect(edge).not.toMatch(/opacity/)
    expect(edge).not.toMatch(/transform/)
  })

  test('and nothing in the component picks a second drawing by state', () => {
    const text = named('lib/SidebarToggle.svelte').text
    // One `svg`, one `rect`, one `path`: no branch that swaps the shapes.
    expect(text.match(/<svg/g)).toHaveLength(1)
    expect(text).not.toMatch(/\{#if[^}]*open[^}]*\}[\s\S]{0,200}<svg/)
  })
})

describe('the row across the top of the app', () => {
  test('is one row tall, and nothing in it is pinned to the top of it', () => {
    const menu = named('lib/AppMenu.svelte')
    const trigger = /\.trigger\s*\{([^}]*)\}/.exec(declarations(menu.style))?.[1] ?? ''

    // The bar stretches what is in it, and a button with a height of its own
    // lands at the top of the row unless it says otherwise - which is where the
    // three bars sat while everything beside them was centred.
    expect(trigger).toMatch(/align-self\s*:\s*center/)

    // The height itself comes from `.nib-glyph` in the themes package, which is
    // the one square every icon button in the app is. It used to be a 30px pill
    // stated here, which made it the only button in the bar at that size.
    expect(menu.text).toMatch(/class="nib-glyph trigger"/)
    expect(trigger).not.toMatch(/height\s*:/)
  })

  test('and the bar itself is the header height', () => {
    const style = declarations(named('lib/Titlebar.svelte').style)
    expect(style).toMatch(/height\s*:\s*var\(--header-height\)/)
  })
})
