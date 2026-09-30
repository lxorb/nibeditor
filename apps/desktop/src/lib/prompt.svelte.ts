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
  /** The keyboard starts on the answer rather than on Cancel, so Enter gives it. */
  lands?: boolean
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
  lands = $state(false)

  private pending: Pending = null

  /** Resolves to the typed text, or null if it was dismissed. */
  ask(options: Ask): Promise<string | null> {
    this.mode = 'text'
    this.title = options.title
    this.detail = ''
    this.value = options.value ?? ''
    this.placeholder = options.placeholder ?? ''
    this.confirmLabel = options.confirmLabel ?? 'Create'
    this.danger = false

    return this.show() as Promise<string | null>
  }

  confirm(options: Confirm): Promise<boolean> {
    this.mode = 'confirm'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.confirmLabel = options.confirmLabel ?? 'Confirm'
    this.danger = options.danger ?? false
    this.lands = options.lands ?? false

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

    this.open = false
    this.pending?.resolve(this.mode === 'confirm' ? '' : typed)
    this.pending = null
  }

  dismiss() {
    this.open = false
    this.pending?.resolve(null)
    this.pending = null
  }
}

export const prompt = new Prompt()
