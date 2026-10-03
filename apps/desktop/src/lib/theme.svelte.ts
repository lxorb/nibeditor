import { contrastCss } from '@nib/themes/contrast'
import { everySurface } from '@nib/themes/write'
import { ACCENTS, accentSetting, DEFAULT_ACCENT } from './accents'
import { tintSystemBars } from './insets'
import { log } from './log'
import { without } from './records'
import { chrome } from './glass/chrome.svelte'
import { groundUnknown, rememberGround, standAsBefore, stoodOnNothing } from './ground'
import {
  forget,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  keep,
  recordOf,
  stored,
  storedText,
} from './stored'
import { invoke, isDesktop, platform } from './tauri'
import {
  type ChosenSettings,
  declares,
  paintOf,
  paintsOver,
  SETTINGS_KEY,
  SHARED,
  type ThemeSetting,
  type ThemeValue,
  valueOf,
} from './themes/settings'
import { type Stamp, STAMP_LINE, stampOf } from './themes/stamp'

export type Scheme = 'dark' | 'light'

/** What a reader may ask the app to be: either scheme by name, or whatever the
 *  system is asking for at the time. */
export type SchemeChoice = Scheme | 'system'

interface ThemeInfo {
  id: string
  name: string
  /** Which schemes the theme states. The two built-in ones state both; a theme file
   *  states whatever its author wrote, which may be one of them. */
  variants: Scheme[]
  path?: string
  /** The stylesheet itself: high contrast's, a file's as `reload` last read it, or
   *  glass's once it has arrived. Held, so choosing or pointing paints at once. */
  css?: string
  /** A built-in's stylesheet behind a door: glass's. */
  load?: () => Promise<string>
  /** Whether the window wears the platform's material: glass's; see material.ts. */
  translucent?: boolean
  /** Whether the sheet carries the reader's picture: wallpaper's. */
  pictured?: boolean
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
const STYLE_ID = 'nib-user-theme'
const CUSTOM_ID = 'nib-custom-css'

/** Where the accent was kept before it was a theme setting. Read, never written. */
const ACCENT_KEY = 'nib:accent'
/** The sheet last worn, for a theme whose own is not in hand as the launch paints, so
 *  the first frame is that theme and not the built-in for a moment. */
const SHEET_KEY = 'nib:theme-sheet'
/** That the contrast theme has been offered, so it is offered once and never
 *  again. Absent means the offer has not been made yet; see `offerContrast`. */
const OFFERED_KEY = 'nib:contrast-offered'
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
 *  row showed; see `paintsOver` in themes/settings.ts.
 *
 *  Offline, because the launch that needs it most is a first launch. See
 *  contrast.css in @nib/themes. */
const CONTRAST: ThemeInfo = {
  id: CONTRAST_THEME,
  name: 'High contrast',
  variants: ['dark', 'light'],
  css: contrastCss,
}

/** And the third: glass, the chrome on the platform's material and the note on paper,
 *  which is what translucency is in this app; see glass.css and docs/design.md. */
const GLASS_THEME = 'glass'

/** Whether glass has a material to stand on: Windows, today. A browser and a phone have
 *  no window of their own, Linux no one answer, and a Mac's webview is opaque until
 *  Tauri's private API is on. Glass is offered everywhere all the same, because what it
 *  is now is the frame taking its colour from what is open, which needs no material;
 *  where there is one, the colour lies over it. This decides only who had the old
 *  Translucency switch. */
function hasMaterial(): boolean {
  return isDesktop && platform() === 'windows'
}

const GLASS: ThemeInfo = {
  id: GLASS_THEME,
  name: 'Glass',
  variants: ['dark', 'light'],
  translucent: true,
  load: () => import('@nib/themes/glass').then((module) => module.glassCss),
}

/** And wallpaper: the reader's picture, in its sheet (wallpaper/sheet.ts). */
const WALLPAPER: ThemeInfo = {
  id: 'wallpaper',
  name: 'Wallpaper',
  variants: ['dark', 'light'],
  pictured: true,
  load: () => import('./wallpaper/sheet').then((module) => module.wallpaperSheet()),
}

const LIGHT = '(prefers-color-scheme: light)'
/** Asked once, at the launch that offers the contrast theme, and never listened
 *  to: a theme is chosen, and a system changing its mind does not get to choose
 *  one. See `offerTheContrastTheme`. */
const MORE = '(prefers-contrast: more)'

/** The app's own settings, a function because their labels follow the language. */
function appSettings(): ThemeSetting[] {
  return [accentSetting()]
}

function isValue(one: unknown): one is ThemeValue {
  return isString(one) || isNumber(one) || isBoolean(one)
}

/** The sheet a launch may wear before its theme's own is in hand; see `SHEET_KEY`. */
function earlySheet(): { id: string; css: string } | null {
  const held = stored(SHEET_KEY)
  if (!isRecord(held) || typeof held.id !== 'string' || typeof held.css !== 'string') return null
  return { id: held.id, css: held.css }
}

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
  /** Every answer the settings were given, in drawers, and what the picker only shows. */
  private chosen = $state<ChosenSettings>({})
  private trying = $state<Record<string, ThemeValue>>({})
  /** The sheet in force, what it declared, and the fetched built-ins' sheets. */
  private sheet = $state('')
  private declared = $state<ThemeSetting[]>([])
  private loaded = $state<Record<string, string>>({})
  /** Whether the material has been asked about this run; see `apply`. */
  private material = false
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
  readonly all = $derived<ThemeInfo[]>([
    DEFAULT_THEME,
    CONTRAST,
    ...(__EVEN_PLUGIN__ ? [] : [this.withLoaded(GLASS)]),
    ...(__EVEN_PLUGIN__ ? [] : [this.withLoaded(WALLPAPER)]),
    ...this.files,
  ])

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
    this.restoreSettings()
    this.early = earlySheet()
    // What the crate put back behind the window before the page started, said on the
    // first frame; and a launch that stood on it, or cannot tell, asks for it off
    // under any other theme.
    if (this.active.translucent === true) standAsBefore()
    this.material = stoodOnNothing() || groundUnknown()
    this.apply()
    void this.reload()
  }

  /** A fetched built-in, with its sheet once in hand. */
  private withLoaded(theme: ThemeInfo): ThemeInfo {
    const css = this.loaded[theme.id]
    return css === undefined ? theme : { ...theme, css }
  }

  /** Fetches those sheets for the picker's cards. */
  warm() {
    for (const theme of this.all) {
      // A card with no sheet is drawn bare, and choosing the theme asks again.
      if (theme.css === undefined && theme.load) void this.fetched(theme).catch(() => undefined)
    }
  }

  private async fetched(theme: ThemeInfo): Promise<string> {
    const held = this.loaded[theme.id]
    if (held !== undefined || !theme.load) return held ?? ''

    const css = await theme.load()
    this.loaded = { ...this.loaded, [theme.id]: css }
    return css
  }

  /** Every answer, the accent's old key read into the app's drawer and left for an
   *  older build. Nothing is trusted: `valueOf` reads each against its setting. */
  private restoreSettings() {
    const drawers: ChosenSettings = Object.fromEntries(
      Object.entries(recordOf(stored(SETTINGS_KEY), isRecord)).map(([owner, values]) => [
        owner,
        recordOf(values, isValue),
      ]),
    )

    const accent = storedText(ACCENT_KEY)
    if (accent !== null && drawers[SHARED]?.accent === undefined) {
      drawers[SHARED] = { ...drawers[SHARED], accent }
    }

    this.chosen = drawers
  }

  /** A reader who had the old Translucency switch on under the built-in is given glass;
   *  any other theme stands. Asked once, by modes.svelte.ts. */
  adoptTranslucency() {
    if (this.id === DEFAULT_ID && !__EVEN_PLUGIN__ && hasMaterial()) this.select(GLASS_THEME)
  }

  /** What was chosen, in whichever version's spelling.
   *
   *  `dark`, `light` and `system` were themes in the dropdown before the scheme
   *  became a choice beside the theme. Each of them means the built-in theme and
   *  a scheme, so that is what they are read as.
   *
   *  Written back in the new spelling at once, so nothing further along has to
   *  know there was an old one. */
  private restoreChoice() {
    const saved = storedText(STORAGE_KEY) ?? ''
    const chosen = storedText(SCHEME_KEY)

    this.scheme = isChoice(chosen) ? chosen : isChoice(saved) ? saved : 'system'

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
   *  The marker is written the moment it happens, so it happens once however it is
   *  answered: a reader who chooses something else keeps that from then on, whatever
   *  their system goes on asking for. */
  private offerTheContrastTheme() {
    if (storedText(OFFERED_KEY)) return

    // Nobody is asking. Left unmarked on purpose: a system that starts asking
    // next month gets the offer then, which is still only ever once.
    if (!window.matchMedia(MORE).matches) return

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
      // called `[data-theme=dark]` would otherwise be read as one that states a
      // scheme it does not state.
      const css = whole.replace(STAMP_LINE, '')

      return {
        ...file,
        // The store's own name for it, which is spelled the way its author
        // spelled it rather than worked out from the file name.
        ...(stamp ? { name: stamp.name, stamp } : {}),
        variants: variantsOf(css),
        ...(whole ? { css } : {}),
      }
    })

    // A theme file may have been deleted while it was selected. Only ever
    // decided on a folder that answered: until one has, a theme the storage
    // names is one not found yet rather than one that is gone.
    if (!this.all.some((theme) => theme.id === this.id)) this.select(DEFAULT_ID)
    // Otherwise applied again now that the folder has been read: at launch the
    // theme was chosen before the files were known, so a file theme had nothing
    // to apply and whatever it declared was nobody's yet.
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
    // Written against Typora's one `#write`, and the app has several; see write.ts.
    style.textContent = everySurface(css)
  }

  /** Chooses the theme, and only the theme. The scheme is left exactly as it
   *  was: a theme with one side shows that side without the choice changing, so
   *  going back to a theme that has both comes back to what was asked for. */
  select(id: string) {
    this.id = id
    this.apply()
    keep(STORAGE_KEY, id)
  }

  /** Shows a look and keeps nothing: what the picker points at. Leaving it is this
   *  again, with what was kept; see theme-picker/picking.svelte.ts. */
  preview(id: string, scheme: SchemeChoice, accent: string) {
    this.id = id
    this.scheme = scheme
    this.trying = { accent }
    this.apply(false)
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

  /** The app's settings the theme does not paint itself, then what it declared. */
  readonly settings = $derived<ThemeSetting[]>([
    ...appSettings().filter((one) => !paintsOver(this.sheet, one)),
    ...this.declared,
  ])

  /** Which drawer a setting's value is kept in; see `ChosenSettings`. */
  private drawerOf(setting: ThemeSetting): string {
    return setting.shared === true ? SHARED : this.id
  }

  /** What each setting holds: what is tried, else what was kept. */
  readonly values = $derived<Record<string, ThemeValue>>(
    Object.fromEntries(
      this.settings.map((one) => [
        one.id,
        valueOf(one, this.trying[one.id] ?? this.chosen[this.drawerOf(one)]?.[one.id]),
      ]),
    ),
  )

  /** A theme's own dial as last kept, worn or not: what a picker card draws. */
  keptFor(owner: string, id: string): ThemeValue | undefined {
    return this.chosen[owner]?.[id]
  }

  /** Turns one dial, and keeps it. */
  set(id: string, value: ThemeValue) {
    const setting = this.settings.find((one) => one.id === id)
    if (!setting) return

    const drawer = this.drawerOf(setting)
    this.chosen = { ...this.chosen, [drawer]: { ...this.chosen[drawer], [id]: value } }
    this.trying = Object.fromEntries(Object.entries(this.trying).filter(([one]) => one !== id))
    keep(SETTINGS_KEY, JSON.stringify(this.chosen))
    this.paintSettings()
  }

  /** The accent by name. */
  readonly accent = $derived<string>(String(this.values.accent ?? DEFAULT_ACCENT))

  /** Whether the accent is the theme's rather than the reader's. */
  readonly accentIsTheme = $derived(!this.settings.some((one) => one.id === 'accent'))

  setAccent(id: string) {
    this.set('accent', id)
  }

  /** Every setting's tokens on the root, over the theme; last time's taken off first. */
  private painted: string[] = []

  private paintSettings() {
    const style = document.documentElement.style
    for (const token of this.painted) style.removeProperty(token)

    const tokens = paintOf(this.settings, this.values, this.current)
    for (const [token, value] of Object.entries(tokens)) style.setProperty(token, value)
    this.painted = Object.keys(tokens)
  }

  /** Which application is the latest. Reading a theme file is a round trip, and
   *  installing one asks for two of them a moment apart: the rescan applies what
   *  is still the old theme, and choosing the new one applies that. Whichever
   *  read finishes last would otherwise decide, which is how the window ends up
   *  wearing one theme's stylesheet under another theme's tokens. */
  private applied = 0

  /** Whose sheet is on the page; see `wear`. */
  private wearing = ''

  /** A fetched built-in's sheet read again: the wallpaper's picture changed. */
  rewear(id: string, kept = true) {
    this.loaded = without(this.loaded, id)
    if (this.id === id) this.apply(kept)
  }

  /** See `SHEET_KEY`. */
  private early: { id: string; css: string } | null = null

  private apply(kept = true) {
    const theme = this.active
    const applying = ++this.applied

    // The scheme decides the tokens, whichever theme sits on top of them: the
    // built-in states both, and a theme file only overrides what it cares about.
    document.documentElement.dataset.theme = this.current

    // A sheet held needs no round trip. One not in hand waits for the disk or its chunk,
    // wearing last time's until then; one gone leaves the built-in tokens.
    const early = this.early?.id === theme.id ? this.early.css : undefined
    this.early = null

    if (theme.css !== undefined) this.wear(theme.css, kept)
    else if (theme.load) {
      if (early !== undefined) this.wear(early, false)
      void this.fetched(theme)
        .then((css) => this.wear(applying === this.applied ? css : null, kept))
        .catch(() => this.wear(applying === this.applied ? '' : null, kept))
    } else if (!theme.path) this.wear('', kept)
    else {
      if (early !== undefined) this.wear(early, false)
      void invoke<string>('read_theme', { path: theme.path })
        .then((css) => this.wear(applying === this.applied ? css : null, kept))
        .catch(() => this.wear(applying === this.applied ? '' : null, kept))
    }

    // Glass follows what is open, and nothing else does; the working out is behind a
    // door only glass opens. See glass/chrome.svelte.ts.
    if (!__EVEN_PLUGIN__) this.followWhatIsOpen(theme.id === GLASS_THEME, kept)

    // The material, behind a door every theme but glass never opens, and on a preview
    // too, so the picker shows glass as glass; see material.ts.
    const translucent = theme.translucent === true
    if (!__EVEN_PLUGIN__ && isDesktop && (translucent || this.material)) {
      this.material = true
      const dark = this.current === 'dark'
      void import('./material').then(({ wearMaterial }) => wearMaterial(translucent, dark, kept))
    }

    this.paintSystemBars()
    // And what the next launch should paint before it has read any of this; see
    // ground.ts. Off the window rather than off the theme, so a theme file's own
    // colour and a translucent window are both what they really are.
    if (kept) rememberGround()
  }

  /** Glass's frame taking its colour from what is open, or let go of. */
  private followWhatIsOpen(glass: boolean, kept: boolean) {
    if (!glass) {
      chrome.sleep()
      if (kept) chrome.forget()
      return
    }

    chrome.wake(this.current)
    void import('./glass/follow.svelte').then((one) => one.follow())
  }

  /** The sheet on the page, then what needs it there: its declarations, the dials, the
   *  bars. Null is an answer that arrived after a newer one. */
  private wear(css: string | null, kept: boolean) {
    if (css === null) return

    this.inject(css)
    const sheet = css.replace(STAMP_LINE, '')
    // A sheet read again keeps its dials until they are read again.
    if (sheet !== this.sheet && (this.wearing !== this.id || !declares(sheet))) this.declared = []
    this.wearing = this.id
    this.sheet = sheet
    this.paintSettings()
    this.paintSystemBars()
    if (kept) this.keepSheet(css)

    if (declares(sheet)) void this.readDeclarations(sheet)
  }

  /** What the next launch wears early; nothing for a theme whose sheet is carried. */
  private keepSheet(css: string) {
    // Not on the glasses, whose storage rides a small cookie; see even/local.ts.
    if (__EVEN_PLUGIN__) return
    const theme = this.active
    if (theme.load === undefined && theme.path === undefined) {
      forget(SHEET_KEY)
      return
    }

    if (earlySheet()?.css !== css) keep(SHEET_KEY, JSON.stringify({ id: theme.id, css }))
  }

  /** What the theme declares, once the grammar behind its door arrives; the sheet
   *  states its own defaults, so the frame in between is right. See declared.ts. */
  private async readDeclarations(css: string) {
    // Left out of the glasses' plugin.
    if (__EVEN_PLUGIN__) return
    const applying = this.applied
    const { declaredIn, readProperty } = await import('./themes/declared')
    if (applying !== this.applied || css !== this.sheet) return

    this.declared = declaredIn(css, readProperty)
    this.paintSettings()
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
    this.paintWindow()
  }

  /** What the Mac's window was last told; see `paintWindow`. */
  private toldWindow: Scheme | null | undefined = undefined

  /** On a Mac the window has an appearance of its own, and the page does not paint
   *  all of it: the translucent ground behind the page, a field's right-click menu,
   *  the save and print sheets. It follows the system unless told otherwise, so a
   *  scheme chosen in the app came out as a dark note in a light window with light
   *  sheets over it. So the window is told, and handed back to the system when the
   *  reader asks to match it - rather than told the system's own answer, because a
   *  window told a scheme is also what the page reads as the system's, and the app
   *  would stop hearing the system change. Nothing of this elsewhere: Windows and
   *  Linux draw no part of the window the page does not. */
  private paintWindow() {
    if (!isDesktop || platform() !== 'macos') return

    const told = this.scheme === 'system' ? null : this.current
    if (told === this.toldWindow) return
    this.toldWindow = told

    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(told))
      .catch((error: unknown) => {
        log('warn', `window appearance: ${error instanceof Error ? error.message : String(error)}`)
      })
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
    // A theme is written against Typora's one `#write`; see write.ts.
    style.textContent = everySurface(css)
  }
}

export const theme = new Themes()
