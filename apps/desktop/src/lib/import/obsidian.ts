/** An Obsidian vault: markdown in folders, which the plain reader already reads,
 *  and `.obsidian/`, which says how the reader liked to write.
 *
 *  The notes need nothing of their own. Wikilinks, embeds, callouts, block ids,
 *  `%%comments%%`, `==highlights==`, `.canvas` and `.base` files are all nib's own
 *  spelling already, which is why the vault is read by plain.ts and only named here.
 *
 *  What is Obsidian's alone is its settings folder. Most of it comes along, so the
 *  space is still a vault Obsidian opens - `templates.json` is even read by nib; see
 *  views/templates.ts - except the parts that are about one machine rather than the
 *  vault: which panes were open, the plugins' code, and Obsidian's own trash. And
 *  `app.json` is read on the way past, for the habits it records; see carry.ts. */

import type { PropertiesMode } from '@nib/markdown/properties'
import type { AttachmentFolder } from '../attachments'
import type { LinkFormat } from '../link-format'
import type { Carried } from './carry'
import type { Source } from './sources'

/** Where the settings folder sits: at the top, or one folder down for a zip whose
 *  one entry is the vault. */
const SETTINGS = /^(?:[^/]+\/)?\.obsidian\//

/** Left behind: the open panes and recent files of the machine it came off
 *  (`workspace.json`, `workspace-mobile.json`), installed plugins and themes, which
 *  are code and styles for another app, a cache, and `.trash/`, which Obsidian
 *  keeps for "Move to Obsidian trash" and which nobody kept on purpose. */
export function leftInVault(path: string): boolean {
  const inside = SETTINGS.exec(path)
  if (inside) {
    const rest = path.slice(inside[0].length)
    return /^workspace[^/]*\.json$/i.test(rest) || /^(plugins|themes|cache)\//i.test(rest)
  }

  return /^(?:[^/]+\/)?\.trash\//.test(path)
}

/** The habits the vault's `app.json` records. Read from what was picked rather
 *  than from the disk, so a vault that arrived as a zip says as much as one that
 *  arrived as a folder. */
export async function obsidianCarries(sources: readonly Source[]): Promise<Carried> {
  const app = sources.find((one) => /^(?:[^/]+\/)?\.obsidian\/app\.json$/.test(one.path))
  let said: unknown = {}

  if (app) {
    try {
      said = JSON.parse(await app.text())
    } catch {
      // A settings file Obsidian could not read either is a vault on its defaults.
    }
  }

  return fromAppJson(said)
}

/** `app.json`, as nib's answers. A key the file does not have is Obsidian's
 *  default, because that is what the reader was looking at: Obsidian writes a key
 *  only once it is changed. */
export function fromAppJson(said: unknown): Carried {
  const app = said !== null && typeof said === 'object' ? (said as Record<string, unknown>) : {}

  return {
    linkFormat: linkFormatOf(app.useMarkdownLinks, app.newLinkFormat),
    // Obsidian's switch is the other way round: strict means a single newline is
    // not a break, and it is off unless somebody turned it on.
    hardBreaks: app.strictLineBreaks !== true,
    attachments: attachmentsOf(app.attachmentFolderPath),
    properties: propertiesOf(app.propertiesInDocument),
    vim: app.vimMode === true,
    // Live Preview shows the marks around the cursor, which is nib's own default.
    quietMarks: false,
    keys: 'obsidian',
  }
}

/** Obsidian's two settings are one question in nib; see link-format.ts. */
function linkFormatOf(markdown: unknown, format: unknown): LinkFormat {
  if (markdown !== true) return 'wikilink'
  return format === 'relative' || format === 'absolute' ? format : 'shortest'
}

/** Where Obsidian puts a pasted picture, as the nearest of nib's three. `/` is
 *  the top of the vault and a bare name a folder there, both of which nib answers
 *  with the space's own `assets/`; `./` is beside the note and `./name` a folder
 *  beside it, which is the note's own folder in nib. */
function attachmentsOf(path: unknown): AttachmentFolder {
  if (typeof path !== 'string') return 'space'
  return path.startsWith('./') ? 'note' : 'space'
}

function propertiesOf(mode: unknown): PropertiesMode {
  switch (mode) {
    case 'source':
      return 'source'
    case 'hidden':
      return 'hidden'
    default:
      return 'properties'
  }
}
