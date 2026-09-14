import { contrastCss } from '@nib/themes/raw'
import { ACCENTS, accentTokens, DEFAULT_ACCENT } from './accents'
import { tintSystemBars } from './insets'
import { log } from './log'
import { forget, keep, storedText } from './stored'
import { invoke } from './tauri'
import { type Stamp, stampOf } from './themes/validate'

export type Scheme = 'dark' | 'light'

/** What a reader may ask the app to be: either scheme by name, or whatever the
 *  system is asking for at the time. */
export type SchemeChoice = Scheme | 'system'

/** The three the control offers, in the order it draws them. Following the
 *  system first, because it is where everybody starts. */
export const SCHEME_CHOICES: SchemeChoice[] = ['system', 'dark', 'light']

/** What each is called. Named here rather than at the control, so the pane, the
 *  palette and anything else that offers the choice say the same word. */
export const SCHEME_NAMES: Record<SchemeChoice, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
}

interface ThemeInfo {
  id: string
  name: string
  /** Which schemes the theme states. The two built-in ones state both; a theme file
   *  states whatever its author wrote, which may be one of them. */
  variants: Scheme[]
  path?: string
  /** The stylesheet itself, for a theme the app ships with rather than reads: the
   *  high contrast one. Applied by the same road a theme file is - see `apply` - so a
   *  built-in palette and an installed one cannot be dressed two different ways. */
  css?: string
  /** Whether the theme states an accent of its own. One that does keeps it: the
   *  card in the store showed that colour, and what the app looks like has to be
   *  what the card showed. */
  ownAccent?: boolean
  /** What the store wrote into the file when it installed it, for a theme that
   *  came from there. Absent for a file somebody put in the folder themselves,
   *  which the store has nothing to say about. */
  stamp?: Stamp
}

interface ThemeFile {
  id: string
  name: string
  path: string
}

const STORAGE_KEY = 'nib:theme'
/** Which scheme was asked for. Its own key, because it is its own choice: a
 *  theme has a dark side or a light one or both, and which of them the app is
 *  showing is not what theme it is. */
const SCHEME_KEY = 'nib:theme-scheme'
/** Where the side of a theme that stated both was kept, before the scheme was a
 *  choice of its own. Read once, by the migration, and never written. */
const SIDE_KEY = 'nib:theme-side'
const STYLE_ID = 'nib-user-theme'
const CUSTOM_ID = 'nib-custom-css'

const ACCENT_KEY = 'nib:accent'
/** That the contrast theme has been offered, so it is offered once and never
 *  again. Absent means the offer has not been made yet; see `offerContrast`. */
const OFFERED_KEY = 'nib:contrast-offered'
/** Where the contrast switch wrote whether it was on, before contrast was a
 *  theme. Read once, by the offer, and never written. */
const CONTRAST_KEY = 'nib:contrast'
/** The high contrast theme's own id. The same word the registry knows it under, and
 *  deliberately: the theme in the store is this palette, published so a reader can
 *  update it without waiting for a release of the app, and a card there that installed
 *  a theme under a different name would be a second Contrast in the dropdown. An
 *  installed copy is a file and carries `file:` in front of its id, so the two can sit
 *  beside each other without either becoming the other. */
const CONTRAST_THEME = 'contrast'

/** The one built-in theme: the app's own tokens, which state both schemes.
 *
 *  There was a Dark and a Light in this list, and they were the same theme twice
 *  with the scheme baked into each. Choosing a look and choosing whether the room
 *  is dark are two questions, and a dropdown that mixed them could not offer a
 *  theme that has both sides without offering it twice. So the built-in is one
 *  theme with two sides, and the scheme is chosen beside it. */
const DEFAULT_ID = 'default'
const DEFAULT_THEME: ThemeInfo = {
  id: DEFAULT_ID,
  name: 'Default',
  variants: ['dark', 'light'],
}

/** And the second: high contrast, which the app ships with rather than fetches.
 *
 *  A mode in every sense that matters - one row in Appearance, one row in the palette,
 *  and what a system asking for more contrast is answered with - and a theme in the
 *  way it is built, which is what keeps it out of every other theme's way. It states
 *  an accent of its own, so the reader's accent is not painted over the palette the
 *  row showed; see `paintAccent`.
 *
 *  Offline, because the launch that needs it most is a first launch. See
 *  contrast.css in @nib/themes. */
const CONTRAST: ThemeInfo = {
  id: CONTRAST_THEME,
  name: 'High contrast',
  variants: ['dark', 'light'],
  ownAccent: true,
  css: contrastCss,
}

const LIGHT = '(prefers-color-scheme: light)'
/** Asked once, at the launch that offers the contrast theme, and never listened
 *  to: a theme is chosen, and a system changing its mind does not get to choose
 *  one. See `offerTheContrastTheme`. */
const MORE = '(prefers-contrast: more)'

/** The line the store writes on the front of a theme it installs. Taken off
 *  before the file is read for what it sets: what it says is a name, not CSS. */
const STAMP_LINE = /^\s*\/\*!\s*nib-theme\s*\{.*?\}\s*\*\//

function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

function isChoice(value: unknown): value is SchemeChoice {
  return isScheme(value) || value === 'system'
}

/** Which schemes a theme file states.
 *
 *  A theme written against the tokens says so outright, in a block per scheme.
 *  A Typora theme knows nothing about the attribute and only declares its
 *  `color-scheme`, so that is what is read for one, and it is the one thing it
 *  is: dropping such a file in has always meant choosing a look, not a pair. */
function variantsOf(css: string): Scheme[] {
  const found = (['light', 'dark'] as const).filter((scheme) =>
    new RegExp(`\\[data-theme\\s*=\\s*['"]?${scheme}['"]?\\s*\\]`).test(css),
  )

  if (found.length) return [...found]
  return [/color-scheme\s*:\s*light/.test(css) ? 'light' : 'dark']
}

class Themes {
  id = $state<string>(DEFAULT_ID)
  /** Which scheme was asked for, which is a choice and not a theme. `system`
   *  follows the media query through the day rather than only at launch. */
  scheme = $state<SchemeChoice>('system')
  accent = $state<string>(DEFAULT_ACCENT)
  files = $state<ThemeInfo[]>([])
  /** What the system currently prefers. */
  private preferred = $state<Scheme>('dark')
  /** Whether the contrast theme is to be offered, which the launch reads once
   *  and acts on by opening the store on it; see `offerTheContrastTheme`. */
  offerContrast = $state(false)

  readonly accents = ACCENTS

  /** The built-in first, then what is installed, in the order the folder gave
   *  them - both platforms list a folder by name, so the order is the same on
   *  every machine and does not move as themes are used. */
  readonly all = $derived<ThemeInfo[]>([DEFAULT_THEME, CONTRAST, ...this.files])

  readonly active = $derived(this.all.find((one) => one.id === this.id) ?? DEFAULT_THEME)

  /** The scheme that was asked for, by name or through the system. */
  readonly wanted = $derived<Scheme>(this.scheme === 'system' ? this.preferred : this.scheme)

  /** The scheme the app is actually in: the one asked for, or the one the theme
   *  in force has where it does not have that one. A theme with a single scheme
   *  is that scheme and never half of one, and a reader asking a light-only theme
   *  for its dark is not handed ours instead. */
  readonly current = $derived<Scheme>(
    this.active.variants.includes(this.wanted)
      ? this.wanted
      : (this.active.variants[0] ?? this.wanted),
  )

  /** What the store has put in the folder, by the id the registry knows it
   *  under, so the gallery can mark a card installed and offer an update. */
  readonly installed = $derived(
    new Map(this.files.flatMap((file) => (file.stamp ? [[file.stamp.id, file] as const] : []))),
  )

  init() {
    const light = window.matchMedia(LIGHT)
    this.preferred = light.matches ? 'light' : 'dark'
    light.addEventListener('change', (event) => {
      this.preferred = event.matches ? 'light' : 'dark'
      if (this.scheme === 'system') this.apply()
    })

    this.restoreChoice()
    this.offerTheContrastTheme()
    this.accent = storedText(ACCENT_KEY) ?? DEFAULT_ACCENT
    this.apply()
    void this.reload()
  }

  /** What was chosen, in whichever version's spelling.
   *
   *  `dark`, `light` and `system` were themes in the dropdown before the scheme
   *  became a choice beside the theme. Each of them means the built-in theme and
   *  a scheme, so that is what they are read as. The side of a theme that stated
   *  both was already this choice under another name, so it is taken as the
   *  scheme where the theme is a file.
   *
   *  Written back in the new spelling at once, so nothing further along has to
   *  know there was an old one. */
  private restoreChoice() {
    const saved = storedText(STORAGE_KEY) ?? ''
    const chosen = storedText(SCHEME_KEY)
    const side = storedText(SIDE_KEY)

    this.scheme = isChoice(chosen)
      ? chosen
      : isChoice(saved)
        ? saved
        : isScheme(side)
          ? side
          : 'system'

    this.id = !saved || saved === 'null' || isChoice(saved) ? DEFAULT_ID : saved

    keep(STORAGE_KEY, this.id)
    keep(SCHEME_KEY, this.scheme)
  }

  /** Whether to answer a system asking for more contrast, which happens once or not
   *  at all.
   *
   *  High contrast is a theme the app ships with, so the answer is the theme itself:
   *  it is chosen, on the frame the launch happens on, with nothing to fetch and no
   *  network to depend on. That is the whole reason it is built in - the launch that
   *  needs more contrast most is a first launch, and a reader who cannot read the
   *  screen cannot be asked to go and find a file.
   *
   *  Chosen *and* shown: Appearance opens on the Style row it was chosen from, so
   *  nothing has silently changed and putting it back is one press. A theme applied
   *  without saying so would be the app deciding what somebody's screen looks like.
   *
   *  One rule covers both the reader who has never launched this and the reader who
   *  had the switch: answer anybody the switch would have been on for at this launch.
   *  It said so itself, or their system says so and they never contradicted it. A
   *  reader who turned the switch off said no to contrast, and that answer stands.
   *
   *  The marker is written the moment it happens, so it happens once however it is
   *  answered: a reader who chooses something else keeps that from then on, whatever
   *  their system goes on asking for. */
  private offerTheContrastTheme() {
    if (storedText(OFFERED_KEY)) return

    const had = storedText(CONTRAST_KEY)
    // Read once. The switch is gone, and the key with it.
    if (had !== null) forget(CONTRAST_KEY)

    // Somebody who turned the switch off has answered the question already.
    if (had === 'off') {
      keep(OFFERED_KEY, 'yes')
      return
    }

    // Nobody is asking. Left unmarked on purpose: a system that starts asking
    // next month gets the offer then, which is still only ever once.
    if (had !== 'on' && !window.matchMedia(MORE).matches) return

    // A reader who has already chosen a theme has answered the question about how
    // their screen looks, and repainting it because their system asks for contrast
    // would be the app overruling them. The question is marked answered: High contrast
    // is a row in Appearance and in the palette, there whenever they want it.
    if (this.id !== DEFAULT_ID) {
      keep(OFFERED_KEY, 'yes')
      return
    }

    keep(OFFERED_KEY, 'yes')
    this.offerContrast = true
    // The theme, now, rather than a card to fetch one from. `select` persists it, so
    // the choice is the reader's from here on and the launch has nothing more to say.
    this.select(CONTRAST_THEME)
  }

  /** Rescans the themes folder, so dropping in a file needs no restart, and so
   *  installing one from the store shows up without one either. Read in
   *  parallel: this runs at launch, and the files are small. */
  async reload() {
    let found: ThemeFile[]

    try {
      found = await invoke<ThemeFile[]>('list_themes')
    } catch (error) {
      // A folder that will not read says nothing about what is in it. Emptying
      // the list here is what took every installed theme out of the dropdown
      // after one failed read - a browser refusing storage, or a page left open
      // across a deploy asking for a chunk that is no longer served - and then
      // wrote the reader's choice away as though the theme had been deleted, so
      // it did not come back on the next launch either. What was found last time
      // stands, and the failure is written down.
      log('warn', `themes: could not list the folder: ${String(error)}`)
      await this.loadCustom()
      return
    }

    const sheets = await Promise.all(
      found.map((file) => invoke<string>('read_theme', { path: file.path }).catch(() => '')),
    )

    const held = this.files
    this.files = found.map((file, at): ThemeInfo => {
      const whole = sheets[at] ?? ''

      // A file that listed but would not read this time is left as it was: its
      // name, its version and its schemes all came out of the file, and a read
      // that failed is not news about any of them.
      const before = whole ? undefined : held.find((one) => one.path === file.path)
      if (before) return before

      const stamp = stampOf(whole)
      // Read past the stamp: it holds a name out of the catalogue, and a theme
      // called `--accent:` would otherwise be read as one that brings its own.
      const css = whole.replace(STAMP_LINE, '')

      return {
        ...file,
        // The store's own name for it, which is spelled the way its author
        // spelled it rather than worked out from the file name.
        ...(stamp ? { name: stamp.name, stamp } : {}),
        variants: variantsOf(css),
        ownAccent: /--accent\s*:/.test(css),
      }
    })

    // A theme file may have been deleted while it was selected. Only ever
    // decided on a folder that answered: until one has, a theme the storage
    // names is one not found yet rather than one that is gone.
    if (!this.all.some((theme) => theme.id === this.id)) this.select(DEFAULT_ID)
    // Otherwise applied again now that the folder has been read: at launch the
    // theme was chosen before the files were known, so a file theme had nothing
    // to apply and its accent was nobody's yet.
    else this.apply()

    await this.loadCustom()
  }

  /** `custom.css` applies on top of whichever theme is active. */
  private async loadCustom() {
    const css = await invoke<string>('read_custom_css').catch(() => '')
    let style = document.getElementById(CUSTOM_ID)

    if (!css.trim()) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = CUSTOM_ID
      // Last in <head>, so it outranks the theme it sits on top of.
      document.head.append(style)
    }
    style.textContent = css
  }

  /** Chooses the theme, and only the theme. The scheme is left exactly as it
   *  was: a theme with one side shows that side without the choice changing, so
   *  going back to a theme that has both comes back to what was asked for. */
  select(id: string) {
    this.id = id
    this.apply()
    keep(STORAGE_KEY, id)
  }

  /** Whether the light and dark switch has anywhere to go, which is what makes
   *  it a switch rather than a button that throws a theme away.
   *
   *  The app's own tokens state both schemes, so the built-in is one pair and the
   *  switch is live on it. A theme file is whatever it said it was: one that
   *  states both is switched inside itself, and one that states a single scheme
   *  has no other side to show. */
  readonly switchable = $derived(this.active.variants.length > 1)

  /** Whether the theme in force can be shown that way.
   *
   *  A theme that states one scheme has no other side, and following the system
   *  would ask it for the side it does not have half the time. So on such a theme
   *  only its own scheme is offered; every control that chooses the scheme reads
   *  this and disables what it cannot honour. */
  offers(choice: SchemeChoice): boolean {
    return this.switchable || choice === this.current
  }

  /** Which of the three a control points at. The choice itself, unless the theme
   *  cannot be shown that way, in which case the scheme it does have: a control
   *  pointing at a scheme the theme lacks would be saying something untrue. */
  readonly shown = $derived<SchemeChoice>(this.switchable ? this.scheme : this.current)

  setScheme(choice: SchemeChoice) {
    if (!this.offers(choice)) return

    this.scheme = choice
    keep(SCHEME_KEY, choice)
    this.apply()
  }

  /** The panel foot's one-click switch: jump to the counterpart scheme. An explicit
   *  choice, so it stops following the system until that is chosen again. */
  toggle() {
    if (!this.switchable) return

    this.setScheme(this.current === 'dark' ? 'light' : 'dark')
  }

  setAccent(id: string) {
    this.accent = id
    keep(ACCENT_KEY, id)
    this.paintAccent()
  }

  /** Whether the accent belongs to the theme rather than to the reader. What
   *  makes the row of swatches worth showing. */
  readonly accentIsTheme = $derived(this.active.ownAccent === true)

  /** Written straight onto the root element, so it sits above whatever theme is
   *  underneath, including one loaded from a file.
   *
   *  Except where the theme brought an accent of its own, which is the one thing
   *  that outranks the reader's colour: a theme is chosen from a picture of it,
   *  and repainting a third of that picture afterwards would make the picture a
   *  lie. Taken off first either way, so the theme underneath is uncovered
   *  rather than left with yesterday's colour written over it. */
  private paintAccent() {
    const style = document.documentElement.style
    const tokens = accentTokens(this.accent, this.current)

    for (const token of Object.keys(tokens)) style.removeProperty(token)
    if (this.accentIsTheme) return

    for (const [token, value] of Object.entries(tokens)) style.setProperty(token, value)
  }

  /** Which application is the latest. Reading a theme file is a round trip, and
   *  installing one asks for two of them a moment apart: the rescan applies what
   *  is still the old theme, and choosing the new one applies that. Whichever
   *  read finishes last would otherwise decide, which is how the window ends up
   *  wearing one theme's stylesheet under another theme's tokens. */
  private applied = 0

  private apply() {
    const theme = this.active
    const applying = ++this.applied

    // The scheme decides the tokens, whichever theme sits on top of them: the
    // built-in states both, and a theme file only overrides what it cares about.
    document.documentElement.dataset.theme = this.current
    this.paintAccent()
    this.paintSystemBars()

    // A theme the app ships with carries its own stylesheet and needs no round trip:
    // the high contrast one is applied on the frame it is chosen on, and on a first
    // launch with no network at all.
    if (theme.css !== undefined) {
      this.inject(theme.css)
      return
    }

    if (!theme.path) {
      this.inject('')
      return
    }

    // A theme file that has gone away leaves the built-in tokens showing,
    // which is what the data attribute above has already set up.
    void invoke<string>('read_theme', { path: theme.path })
      .then((css) => this.inject(applying === this.applied ? css : null))
      .catch(() => this.inject(applying === this.applied ? '' : null))
  }

  /** The bars the system draws over the page: its clock and battery at the top,
   *  its gesture bar at the bottom. A browser and an installed web app tint
   *  them from the meta tag; the Android app draws under them and is asked
   *  instead which way round the icons go, since nothing in CSS reaches those.
   *  Either way the difference is an app that ends at the page and one that
   *  does not. */
  private paintSystemBars() {
    const tag = document.querySelector('meta[name="theme-color"]')
    if (tag) {
      // Read back rather than guessed: a theme file may have replaced --bg.
      const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      if (background) tag.setAttribute('content', background)
    }

    tintSystemBars(this.current === 'dark')
  }

  /** Puts the active theme's stylesheet on the page. Null is an answer that
   *  arrived after a newer one: nothing to do, and above all not to be applied. */
  private inject(css: string | null) {
    if (css === null) return

    let style = document.getElementById(STYLE_ID)

    if (!css) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      // Before any custom.css block, which must stay last.
      document.head.insertBefore(style, document.getElementById(CUSTOM_ID))
    }
    style.textContent = css
  }
}

export const theme = new Themes()
