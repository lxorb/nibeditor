/** What a refusal says, wherever it is said: under a terminal's screen, in the sheet that
 *  answers New online terminal, and in Settings. One sentence each, or none for a refusal
 *  that needs no words - typing refused (the screen still shows), a frame too fast or too
 *  large, a rate a second press will not hit. */

import type { Refusal } from '@nib/online/wire'
import { t } from '../i18n.svelte'
import type { Refused } from './calls'

export function refusalWords(why: Refused | Refusal): string | null {
  switch (why) {
    case 'gone':
      return t('This terminal is not shared with you')
    case 'list':
      return t('Online terminals are not open to your account yet')
    case 'allowance':
      return t('This month’s online hours are used')
    case 'budget':
    case 'off':
      return t('Online terminals are paused for now')
    case 'flag':
      return t('This machine is stopped')
    case 'sessions':
      return t('Your machine has eight terminals already')
    case 'other':
      return t('Could not reach your machine')
    case 'signed-out':
      return t('Sign in to use an online terminal')
    case 'role':
    case 'rate':
    case 'large':
      return null
  }
}
