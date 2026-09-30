/** The settings an agent may read and change: `read_setting` and `write_setting`
 *  (docs/agent-native.md 8.8).
 *
 *  A short list, read freely and written only with `settings` and the reader's say:
 *  how the app looks, which language it speaks, the editor's options, and where a
 *  space keeps what websites store. Never the account, the sync, the AI keys, the
 *  agents' own grants or anything in `automation.json` - those are not in the list, so
 *  there is no name to ask for them by. Each is written through the call the settings
 *  pane itself makes, so what changes is what the pane would have changed. */

import type { AgentAnswer } from '../../automation/caller'
import { ACCENTS } from '../../accents'
import { CATALOGUE_IDS, i18n } from '../../i18n.svelte'
import { LINK_FORMATS } from '../../link-format'
import { LINE_HEIGHTS, modes, WIDTHS } from '../../modes.svelte'
import { theme } from '../../theme.svelte'
import { asked } from './asks'
import { type Call, done, maybe, need } from './call'
import { Refused } from './problem'
import { placeFor } from './spaces'

/** One setting: what it says now, and how it is changed. `write` is handed the value
 *  as the agent sent it, refuses what the setting cannot be, and answers the change
 *  itself, which is made only once the reader has said yes. */
interface Setting {
  about: string
  read: (call: Call) => unknown
  write: (value: unknown, call: Call) => Change | Promise<Change>
}

type Change = () => unknown

function oneOf<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  const found = choices.find((one) => one === value)
  if (found === undefined)
    throw new Refused('bad_arguments', `${name} is one of ${choices.join(', ')}`)

  return found
}

function isOn(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value
  throw new Refused('bad_arguments', `${name} is true or false`)
}

function numberIn(value: unknown, choices: readonly number[], name: string): number {
  const said = Number(value)
  const found = choices.find((one) => Math.abs(one - said) < 1e-9)
  if (found === undefined)
    throw new Refused('bad_arguments', `${name} is one of ${choices.join(', ')}`)

  return found
}

/** A switch the editor turns with a toggle, set to what was asked. */
function toggled(read: () => boolean, toggle: () => void, about: string): Setting {
  return {
    about,
    read,
    write: (value, call) => {
      const wanted = isOn(value, need(call, 'key'))
      return () => {
        if (read() !== wanted) toggle()
      }
    },
  }
}

const SETTINGS: Record<string, Setting> = {
  theme: {
    about: 'the theme, by id',
    read: () => theme.id,
    write: (value) => {
      const id = oneOf(
        value,
        theme.all.map((one) => one.id),
        'theme',
      )
      return () => theme.select(id)
    },
  },
  scheme: {
    about: 'light, dark or system',
    read: () => theme.scheme,
    write: (value) => {
      const choice = oneOf(value, ['light', 'dark', 'system'] as const, 'scheme')
      return () => theme.setScheme(choice)
    },
  },
  accent: {
    about: 'the accent colour, by name',
    read: () => theme.accent,
    write: (value) => {
      const id = oneOf(
        value,
        ACCENTS.map((one) => one.id),
        'accent',
      )
      return () => theme.setAccent(id)
    },
  },
  language: {
    about: 'the language the app speaks, or system',
    read: () => i18n.choice,
    write: (value) => {
      const id = oneOf(value, ['system', ...CATALOGUE_IDS], 'language')
      return () => i18n.select(id)
    },
  },
  spellcheck: toggled(
    () => modes.spellcheck,
    () => modes.toggleSpellcheck(),
    'whether spelling is checked',
  ),
  line_numbers: toggled(
    () => modes.lineNumbers,
    () => modes.toggleLineNumbers(),
    'line numbers in code blocks',
  ),
  close_brackets: toggled(
    () => modes.closeBrackets,
    () => modes.toggleCloseBrackets(),
    'whether a bracket typed is closed',
  ),
  vim: {
    about: 'vim keys in the editor',
    read: () => modes.vim,
    write: (value) => {
      const on = isOn(value, 'vim')
      return () => modes.setVimKeys(on)
    },
  },
  width: {
    about: 'how wide a line of a note is, in characters',
    read: () => modes.width,
    write: (value) => {
      const width = numberIn(value, WIDTHS, 'width')
      return () => modes.setWidth(width)
    },
  },
  line_height: {
    about: 'the space between lines',
    read: () => modes.lineHeight,
    write: (value) => {
      const height = numberIn(value, LINE_HEIGHTS, 'line_height')
      return () => modes.setLineSpacing(height)
    },
  },
  link_format: {
    about: 'how a link to another note is written',
    read: () => modes.linkFormat,
    write: (value) => {
      const format = oneOf(value, LINK_FORMATS, 'link_format')
      return () => modes.setLinkFormat(format)
    },
  },
  web_data: {
    about: 'where a space keeps what websites store: global, space or site',
    read: async (call) => {
      const { webData } = await import('../../web-tab/web-data.svelte')
      return webData.of(placeFor(call, maybe(call, 'space')).space.id)
    },
    write: async (value, call) => {
      const { WEB_DATA } = await import('../../web-tab/web-data')
      const choice = oneOf(value, WEB_DATA, 'web_data')
      const space = placeFor(call, maybe(call, 'space')).space
      const [{ webData }, { pages }] = await Promise.all([
        import('../../web-tab/web-data.svelte'),
        import('../../web-tab/pages.svelte'),
      ])

      // The space's open pages built again in the store it now keeps, as choosing it
      // from the space's menu does; see `chooseWebData` in space-actions.ts.
      return async () => {
        webData.set(space.id, choice)
        await pages.restore(space.id)
      }
    },
  },
}

/** The setting a call names, or a refusal that lists the ones there are. */
function settingOf(call: Call): { key: string; setting: Setting } {
  const key = need(call, 'key')
  const setting = SETTINGS[key]
  if (!setting) {
    throw new Refused(
      'no_such_setting',
      `the settings an agent reaches are ${Object.keys(SETTINGS).join(', ')}`,
    )
  }

  return { key, setting }
}

export async function readSetting(call: Call): Promise<AgentAnswer> {
  const { key, setting } = settingOf(call)
  return done({ key, value: await setting.read(call), about: setting.about })
}

export async function writeSetting(call: Call): Promise<AgentAnswer> {
  const { key, setting } = settingOf(call)
  if (!('value' in call.args)) throw new Refused('bad_arguments', 'say the value')

  const value = call.args.value
  const was = await setting.read(call)
  if (JSON.stringify(was) === JSON.stringify(value)) return done({ key, value, changed: false })

  const change = await setting.write(value, call)
  const question = await asked(call, 'settings', `Change ${key} to ${JSON.stringify(value)}`)
  if (question) return question

  await change()
  return done({ key, value: await setting.read(call), changed: true })
}
