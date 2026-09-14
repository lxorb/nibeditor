import type { FileMark } from './file-mark'

interface Ask {
  title: string
  /** Prefilled text, for a rename. */
  value?: string
  placeholder?: string
  confirmLabel?: string
}

interface Confirm {
  title: string
  /** What will happen, in one sentence. Shown under the title. */
  detail?: string
  confirmLabel?: string
  danger?: boolean
}

interface Choice {
  id: string
  label: string
  primary?: boolean
  danger?: boolean
  /** The mark the row wears, where the answers are things a file list also
   *  shows. Absent for a question about anything else, and then the row is words
   *  alone. The `id` is the path, so a row that chose an icon of its own wears it
   *  here as well; see FileMark.svelte. */
  mark?: FileMark
  /** The space this row is, where it is a space rather than a file: the one being
   *  looked at, or another to move something into. It wears what the switcher
   *  gives it - the space's own icon, or its first letter - in the box a mark
   *  would be in, so the names in the list still read as one column. */
  space?: { id: string | null; name: string }
}

interface Choose {
  title: string
  detail?: string
  options: Choice[]
}

/** One of many, found by typing rather than by reading a list of them. */
interface Find {
  title: string
  options: Choice[]
  placeholder?: string
}

interface SpaceOption {
  id: string
  name: string
}

interface AskName extends Ask {
  /** Offered as a dropdown beside the name. Hidden when there is only one. */
  spaces: SpaceOption[]
  space: string | null
  /** Where the file will be written, as folders rather than spaces: the space's own
   *  room, a note that would become a folder, another space. What a save offers, and
   *  the sheet shows these instead of the spaces where a caller hands them over - a
   *  folder already says which space it is in. See move-targets.ts. */
  folders?: FolderOption[]
  folder?: string | null
}

interface FolderOption {
  /** The folder's own path, which is what a caller writes into. */
  id: string
  label: string
}

interface NamedIn {
  name: string
  space: string | null
  /** The folder chosen, where folders were offered. */
  folder: string | null
}

type Pending = { resolve: (answer: unknown) => void } | null

/** One small modal for the questions the app ever asks: name this, are you sure,
 *  which of these few, and which of these many. Each resolves a promise, so the
 *  caller reads top to bottom. */
class Prompt {
  open = $state(false)
  mode = $state<'text' | 'confirm' | 'choose' | 'find'>('text')
  options = $state<Choice[]>([])
  title = $state('')
  detail = $state('')
  value = $state('')
  placeholder = $state('')
  confirmLabel = $state('')
  danger = $state(false)
  spaces = $state<SpaceOption[]>([])
  space = $state<string | null>(null)
  folders = $state<FolderOption[]>([])
  folder = $state<string | null>(null)

  private pending: Pending = null

  /** Whether the question was "what shall it be called, and where" rather than "what
   *  shall it be called". Set by `askName` and cleared by everything else: a caller that
   *  asked where cannot be answered with a bare name, and a list of places that turned
   *  out to hold one row is still a question about where. */
  private naming = false

  /** Resolves to the typed text, or null if it was dismissed. */
  ask(options: Ask): Promise<string | null> {
    this.mode = 'text'
    this.title = options.title
    this.detail = ''
    this.value = options.value ?? ''
    this.placeholder = options.placeholder ?? ''
    this.confirmLabel = options.confirmLabel ?? 'Create'
    this.danger = false
    this.spaces = []
    this.space = null
    this.folders = []
    this.folder = null
    this.naming = false

    return this.show() as Promise<string | null>
  }

  /** A name and where to put it: a space, or - what a save asks - a folder. */
  askName(options: AskName): Promise<NamedIn | null> {
    this.mode = 'text'
    this.title = options.title
    this.detail = ''
    this.value = options.value ?? ''
    this.placeholder = options.placeholder ?? ''
    this.confirmLabel = options.confirmLabel ?? 'Save'
    this.danger = false
    this.spaces = options.spaces
    this.space = options.space ?? options.spaces[0]?.id ?? null
    this.folders = options.folders ?? []
    this.folder = options.folder ?? this.folders[0]?.id ?? null
    this.naming = true

    return this.show() as Promise<NamedIn | null>
  }

  confirm(options: Confirm): Promise<boolean> {
    this.mode = 'confirm'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.confirmLabel = options.confirmLabel ?? 'Confirm'
    this.danger = options.danger ?? false
    this.naming = false

    return this.show().then((answer) => answer !== null)
  }

  /** More than two ways to answer - resolves the chosen id, or null if the
   *  question was dismissed, which always means "do nothing". */
  choose(options: Choose): Promise<string | null> {
    this.mode = 'choose'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.options = options.options
    this.spaces = []
    this.folders = []
    this.naming = false

    return this.show() as Promise<string | null>
  }

  /** Too many to read at once: the same sheet with a field above the list, and
   *  the list narrowing as it is typed into. Resolves the chosen id, or null.
   *
   *  Its own mode rather than a long `choose`, because a space can hold thousands
   *  of notes and a question with thousands of buttons is not a question. */
  find(options: Find): Promise<string | null> {
    this.mode = 'find'
    this.title = options.title
    this.detail = ''
    this.value = ''
    this.placeholder = options.placeholder ?? ''
    this.options = options.options
    this.spaces = []
    this.folders = []
    this.naming = false

    return this.show() as Promise<string | null>
  }

  /** Answers a `choose` or a `find` with one of its options. */
  pick(id: string) {
    this.open = false
    this.pending?.resolve(id)
    this.pending = null
  }

  private show(): Promise<unknown> {
    // A second question replaces the first rather than stacking on it.
    this.pending?.resolve(null)
    this.open = true

    return new Promise((resolve) => {
      this.pending = { resolve }
    })
  }

  submit() {
    const typed = this.value.trim()
    if (this.mode === 'text' && !typed) return

    // A name asked for with somewhere to put it resolves both; everything else is a
    // string. The folder travels even where only one was offered and no dropdown was
    // drawn: the caller asked where to write, and there is an answer either way.
    const answer = this.naming ? { name: typed, space: this.space, folder: this.folder } : typed

    this.open = false
    this.pending?.resolve(this.mode === 'confirm' ? '' : answer)
    this.pending = null
  }

  dismiss() {
    this.open = false
    this.pending?.resolve(null)
    this.pending = null
  }
}

export const prompt = new Prompt()
