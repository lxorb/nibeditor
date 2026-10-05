import { setSnippets } from '@nib/editor'
import { connectors } from './connectors.svelte'
import { message } from './i18n.svelte'
import { DEFAULT_ID_FORMAT, ID_FORMATS } from './note-id'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, type PageSetup, PAPER_SIZES } from './paper'
import { isRecord, isString, keep, stored, storedText } from './stored'
import { invoke, isDesktop, isNative } from './tauri'

const PAGE_KEY = 'nib:page'
const APPEARANCE_KEY = 'nib:export-appearance'
const NOTE_ID_KEY = 'nib:note-id'

/** How an exported page is coloured: light, dark, or as the app looks now. */
type ExportAppearance = 'light' | 'dark' | 'app'

export type Section =
  | 'general'
  | 'editor'
  | 'shortcuts'
  | 'mobile'
  | 'spelling'
  | 'markdown'
  | 'appearance'
  | 'glasses'
  | 'ai'
  | 'agents'
  | 'remote'
  | 'online'
  | 'account'
  | 'sync'
  | 'llm'
  | 'trash'
  | 'export'

class Settings {
  open = $state(false)
  section = $state<Section>('general')
  /** On a phone the panes are a list first and a page second: this is whether
   *  the list is showing rather than one of them. A desktop shows both. */
  listing = $state(true)
  /** The version-history sheet, which is its own overlay. */
  historyOpen = $state(false)

  /** Whether pandoc is on this machine, which decides the export list. */
  pandoc = $state(false)

  /** Paper and running text for export. A note's front matter overrules it. */
  page = $state<PageSetup>({ ...DEFAULT_PAGE_SETUP })

  /** Light by default: a document is read on paper, or sent to someone whose
   *  screen is not this one. */
  exportAppearance = $state<ExportAppearance>('light')

  /** Whether Explorer's "New" menu offers a markdown document. Windows only. */
  newMenu = $state(false)

  /** How "New unique note" spells the moment it names a note after. Only that
   *  command uses it; every other note is named by whoever writes it. */
  noteIdFormat = $state(DEFAULT_ID_FORMAT)

  /** What went wrong, wherever a pane or an action wants to say so. */
  error = $state<string | null>(null)

  restore() {
    connectors.restore()

    // Field by field, so a paper size this build has never heard of costs the
    // reader their paper and not their margins as well.
    const saved = stored(PAGE_KEY)
    if (isRecord(saved)) {
      this.page = {
        paper: PAPER_SIZES.find((one) => one === saved.paper) ?? DEFAULT_PAGE_SETUP.paper,
        orientation:
          ORIENTATIONS.find((one) => one === saved.orientation) ?? DEFAULT_PAGE_SETUP.orientation,
        margin: isString(saved.margin) ? saved.margin : DEFAULT_PAGE_SETUP.margin,
        header: isString(saved.header) ? saved.header : DEFAULT_PAGE_SETUP.header,
        footer: isString(saved.footer) ? saved.footer : DEFAULT_PAGE_SETUP.footer,
      }
    }

    // Only a format this build knows how to fill in, so a value written by a
    // later one cannot leave every unique note sharing a name.
    const format = storedText(NOTE_ID_KEY)
    if (format && ID_FORMATS.includes(format)) this.noteIdFormat = format

    const appearance = storedText(APPEARANCE_KEY)
    if (appearance === 'light' || appearance === 'dark' || appearance === 'app') {
      this.exportAppearance = appearance
    }

    void import('./export').then(({ pandocAvailable }) =>
      pandocAvailable().then((found) => (this.pandoc = found)),
    )

    void this.loadSnippets()

    if (isDesktop) {
      void invoke<boolean>('new_menu_registered')
        .then((on) => (this.newMenu = on))
        .catch(() => undefined)
    }
  }

  /** Adds or removes Explorer's "New ▸ Markdown Document" entry. */
  async setNewMenu(enabled: boolean) {
    if (!isDesktop) return

    this.error = null
    try {
      await invoke('set_new_menu', { enabled })
      this.newMenu = enabled
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  setPage(patch: Partial<PageSetup>) {
    this.page = { ...this.page, ...patch }
    keep(PAGE_KEY, JSON.stringify(this.page))
  }

  setNoteIdFormat(format: string) {
    this.noteIdFormat = format
    keep(NOTE_ID_KEY, format)
  }

  setExportAppearance(appearance: ExportAppearance) {
    this.exportAppearance = appearance
    keep(APPEARANCE_KEY, appearance)
  }

  /** Reads `snippets.json` into the editor's completion source. */
  async loadSnippets() {
    if (!isNative) return

    const raw = await invoke<string>('read_snippets').catch(() => '{}')
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const usable = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>

      setSnippets(usable)
    } catch {
      // A malformed file simply means no snippets, not a broken editor.
      setSnippets({})
    }
  }

  /** Opens on General, or on the list of panes where the screen is a phone's.
   *  Asked for by name, a pane opens straight away on both. */
  show(section?: Section) {
    this.section = section ?? 'general'
    this.listing = section === undefined
    this.open = true
    this.error = null
    connectors.freshToken = null
  }
}

export const settings = new Settings()
