/** The commands on words (docs/ai-sidebar.md 3.5): on the selection, else the note in
 *  front, and answered as a change to keep rather than a reply to copy.
 *
 *  The four rewrites are the rewrite menu's own (rewrite.ts): the same sheet, with the
 *  diff beside the words and Keep or nothing, opened on the selection or, with nothing
 *  selected, on the whole of the note below its front matter. `/summarize` and `/review`
 *  are the agent's edits, which land on the changes bar to keep or undo; `/explain` is the
 *  one that is a reply. The prompts are the model's to read and are not translated. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import { languageNames, type Verb } from '../rewrite'
import type { Thread } from '../chat/types'
import { type Host, sendHere } from './host'

/** A language as typed - `de`, `Deutsch`, `German` - as the rewrite sheet's id, or
 *  null for one it does not offer. */
export function languageIn(
  typed: string,
  inEnglish: (id: string) => string = englishName,
): string | null {
  const want = typed.trim().toLowerCase()
  if (!want) return null
  const found = languageNames().find(
    (one) =>
      one.id.toLowerCase() === want ||
      one.name.toLowerCase() === want ||
      inEnglish(one.id).toLowerCase() === want,
  )
  return found?.id ?? null
}

function englishName(id: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(id) ?? id
  } catch {
    return id
  }
}

/** A rewrite on the selection, or on the note in front where nothing is selected. False
 *  where no note is open to write in. */
export async function rewrite(verb: Verb, language = ''): Promise<boolean> {
  const view = views.of(workspace.panes.focusedId)
  if (!view || view.state.readOnly) return false
  if (view.state.selection.main.empty) {
    const doc = view.state.doc.toString()
    const from = frontMatterBlock(doc)?.to ?? 0
    if (from >= doc.length) return false
    view.dispatch({ selection: { anchor: from, head: doc.length } })
  }
  const { rewriting } = await import('../rewriting.svelte')
  rewriting.show(view)
  const id = languageIn(language)
  rewriting.language = id ?? rewriting.language
  rewriting.run(verb)
  return true
}

/** What the words are about, for a prompt: a named note, or the selection or the note
 *  in front. */
function about(named: string): string {
  const name = named.trim().replace(/^\[\[|\]\]$/g, '')
  return name
    ? `the note [[${name}]]`
    : 'the selection, or the note in front if nothing is selected'
}

function explainPrompt(): string {
  return `Explain ${about('')}: what it means and why, briefly, in the language it is written in.`
}

function summarizePrompt(named: string): string {
  return [
    `Write a summary of ${about(named)} of a few sentences,`,
    'and add it to that note under its first heading (at the top where it has none) with edit_note.',
    'Change nothing else in it.',
  ].join(' ')
}

function reviewPrompt(target: string): string {
  if (target.trim().toLowerCase() === 'changes') {
    return 'Review the changes you made to notes in this thread: say what is wrong or missing in each, and fix what should be fixed with edit_note.'
  }
  return [
    `Review ${about(target)} for clarity, for claims that need support, and for structure.`,
    'Make each suggestion as a small edit to the note with edit_note, so it can be kept or undone one by one,',
    'and list them briefly in your answer.',
  ].join(' ')
}

export function explain(host: Host, thread: Thread | null): void {
  sendHere(host, thread, explainPrompt())
}

export function summarize(host: Host, thread: Thread | null, named: string): void {
  sendHere(host, thread, summarizePrompt(named), { mode: 'agent' })
}

export function review(host: Host, thread: Thread | null, target: string): void {
  sendHere(host, thread, reviewPrompt(target), { mode: 'agent' })
}
