/** An Evernote `.enex` export.
 *
 *  One file per notebook, holding a `<note>` per note: a title, the body as ENML
 *  (which is XHTML with three tags of Evernote's own), the dates, the tags, and
 *  every attachment as base64 right there in the file. So an `.enex` is the one
 *  export that needs no folder and no second file, and the one that can be half a
 *  gigabyte.
 *
 *  The three tags of its own are why this is not simply the HTML converter:
 *
 *  `<en-media hash="...">` is how a note points at its own picture, by the MD5 of
 *  the attachment's bytes. It becomes an ordinary picture or a link to the file,
 *  which is what makes an imported note show the photograph that was in it.
 *
 *  `<en-todo>` is a checkbox, which becomes a task list, because that is what it
 *  was for.
 *
 *  `<en-crypt>` is text encrypted with a passphrase nib does not have and never
 *  will. Those are counted and said out loud rather than quietly dropped. */

import { fromBase64 } from '../bytes'
import { key } from '../i18n.svelte'
import { htmlToMarkdown } from '@nib/markdown/from-html'

import { dayOf, noteText, type Meta } from './meta'
import { md5 } from './md5'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'
import { element, elements, plainText, textOf, textsOf } from './xml'

/** Where an attachment goes: one folder for the lot, beside the notes, which is
 *  the same arrangement the app's own Attachments setting means by `assets`. */
const ASSETS = 'assets'

/** The extensions worth naming, for a file whose own name the export lost. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'text/plain': 'txt',
}

export async function readEvernote(sources: readonly Source[]): Promise<ImportPlan> {
  const files = sources.filter((one) => /\.enex$/i.test(one.path))
  const names = new Names()
  const written: Planned[] = []
  const lost: Lost[] = []
  let encrypted = 0
  let reminders = 0

  // A notebook each when there are several, because that is what the files are;
  // one file is the import itself and needs no folder of its own.
  const perNotebook = files.length > 1

  for (const source of files) {
    const xml = await source.text()
    const notebook = perNotebook
      ? safeName((source.path.split('/').pop() ?? '').replace(/\.enex$/i, ''))
      : ''

    for (const note of elements(xml, 'note')) {
      const content = textOf(note.inner, 'content') ?? ''
      const attachments = new Map<string, string>()

      for (const resource of elements(note.inner, 'resource')) {
        const encoded = element(resource.inner, 'data')?.inner ?? ''
        const bytes = fromBase64(plainText(encoded))
        if (!bytes.length) continue

        const mime = (textOf(resource.inner, 'mime') ?? '').trim().toLowerCase()
        const said = textOf(resource.inner, 'file-name')
        const hash = md5(bytes)
        const name = names.free(`${ASSETS}/${fileName(said, mime, hash)}`)

        written.push({ kind: 'file', path: name, bytes })
        attachments.set(hash, name)
      }

      const enml = withoutEvernote(content, attachments, !!notebook)
      if (enml.encrypted) encrypted += enml.encrypted
      if (textOf(note.inner, 'reminder-order') !== null) reminders += 1

      // The title after the words, because a note with no title of its own is
      // named after what it says, and what it says is the markdown rather than
      // the markup it arrived as.
      // The addresses in an export are the export's own to resolve; see
      // `fileTargets` and rewrite.ts.
      const words = htmlToMarkdown(enml.html, { fileTargets: true, appTargets: true })
      const said = textOf(note.inner, 'title')?.trim()
      const title = (said ? safeName(said) : titleFrom(words)) ?? 'Untitled'
      const path = names.free(`${notebook ? `${notebook}/` : ''}${title}.md`)

      const meta: Meta = { tags: textsOf(note.inner, 'tag') }
      const made = dayOf(textOf(note.inner, 'created'))
      const changed = dayOf(textOf(note.inner, 'updated'))
      if (made) meta.date = made
      if (changed) meta.updated = changed

      const origin = textOf(note.inner, 'source-url')
      if (origin) meta.extra = [['source', origin]]

      written.push({ kind: 'note', path, text: noteText(title, words, meta) })
    }
  }

  if (encrypted) {
    lost.push({
      text: key('{count} passages are encrypted, and nothing can read them without Evernote'),
      values: { count: encrypted },
    })
  }

  if (reminders) {
    lost.push({
      text: key('{count} notes had a reminder, which the export does not carry'),
      values: { count: reminders },
    })
  }

  return { format: 'evernote', files: written, lost }
}

/** What to call an attachment: its own name where the export kept one, and its
 *  hash where it did not, which is what the app already names a pasted picture. */
function fileName(said: string | null, mime: string, hash: string): string {
  const named = said?.trim() ? safeName(said.trim()) : ''
  if (named && /\.[A-Za-z0-9]{1,5}$/.test(named)) return named

  const extension = EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? 'bin'
  return named ? `${named}.${extension}` : `${hash.slice(0, 16)}.${extension}`
}

/** Evernote's own three tags turned into markup the converter knows, and the
 *  count of what had to be left as it was. */
function withoutEvernote(
  enml: string,
  attachments: ReadonlyMap<string, string>,
  inFolder: boolean,
): { html: string; encrypted: number } {
  let encrypted = 0

  // A checkbox line is a task list item, which is what it was drawn as.
  let html = enml.replace(
    /<div[^>]*>\s*<en-todo([^>]*)\/?>\s*([\s\S]*?)<\/div>/gi,
    (_whole, said: string, rest: string) =>
      `<ul><li><input type="checkbox"${/checked="?true/i.test(said) ? ' checked' : ''}>${rest}</li></ul>`,
  )

  // One outside a div still says what it was.
  html = html.replace(/<en-todo([^>]*)\/?>/gi, (_whole, said: string) =>
    /checked="?true/i.test(said) ? '[x] ' : '[ ] ',
  )

  // One character rather than a word: nothing can read the passage, a word in
  // one language written into somebody's note is worse than a mark that says
  // "something was here", and an ellipsis is that mark in every language. The
  // count is what the sheet says out loud before any of it is written.
  html = html.replace(/<en-crypt[\s\S]*?<\/en-crypt>|<en-crypt[^>]*\/>/gi, () => {
    encrypted += 1
    return '<p>…</p>'
  })

  // A note in a notebook's folder is one level below the attachments.
  const folder = inFolder ? '../' : ''

  html = html.replace(/<en-media([^>]*)\/?>(?:<\/en-media>)?/gi, (_whole, said: string) => {
    const hash = /hash="([0-9a-f]+)"/i.exec(said)?.[1]?.toLowerCase() ?? ''
    const path = attachments.get(hash)
    if (!path) return ''

    const address = `${folder}${path}`.replace(/ /g, '%20')
    const type = /type="([^"]+)"/i.exec(said)?.[1]?.toLowerCase() ?? ''
    const name = path.split('/').pop() ?? path

    // A picture is shown and everything else is a link to the file, which is
    // what a paper or a spreadsheet in a note should be.
    return type.startsWith('image/')
      ? `<img src="${address}" alt="">`
      : `<a href="${address}">${name}</a>`
  })

  return { html, encrypted }
}
