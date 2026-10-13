/** What each kind of tab is called: on the press that makes one, and on its row in
 *  Settings › Note types. Said once, so no two places call one kind two things. */

import { type KindName } from './settings.svelte'
import { t } from './i18n.svelte'

/** What a press that makes one says, wherever it is offered. */
export function kindLabel(kind: KindName): string {
  return {
    note: () => t('New note'),
    canvas: () => t('New canvas'),
    pages: () => t('New page note'),
    chat: () => t('New chat'),
    terminal: () => t('New terminal'),
    remote: () => t('Remote'),
    online: () => t('Online terminal'),
    web: () => t('New web note'),
    private: () => t('New private tab'),
  }[kind]()
}

/** Its row in Settings › Note types. */
export function kindName(kind: KindName): string {
  return {
    note: () => t('Note'),
    canvas: () => t('Canvas'),
    pages: () => t('Page note'),
    chat: () => t('Chat'),
    terminal: () => t('Terminal'),
    remote: () => t('Remote'),
    online: () => t('Online terminal'),
    web: () => t('Web note'),
    private: () => t('Private tab'),
  }[kind]()
}
