/** Which models the account's key may choose, and the one line of prose under the
 *  key field.
 *
 *  A store rather than a constant because the list comes from the API: model names
 *  change every few months, and a list written into the settings pane would be a
 *  list of models that used to exist. So the pane asks Nib, which asks OpenAI with
 *  the account's own key and keeps the answer for a day; see the Worker's
 *  ask/models.ts.
 *
 *  It owns that one line because the four things it can say - asking, a key that was
 *  refused, nothing to offer, nothing to say - are the four states of this fetch and
 *  nothing else knows them. */

import { account } from '../account.svelte'
import { api } from '../api'
import { key, t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { glassesKey } from './key.svelte'
import { EFFORTS } from './models'

/** How hard the model is asked to think, in the words a reader would use.
 *
 *  The values are the API's own; the words are ours, because "xhigh" is not a word
 *  and a settings pane is not a wire format. */
export const EFFORT_WORDS: readonly { value: (typeof EFFORTS)[number]; label: string }[] = [
  { value: 'none', label: key('No reasoning') },
  { value: 'minimal', label: key('Minimal') },
  { value: 'low', label: key('Low') },
  { value: 'medium', label: key('Medium') },
  { value: 'high', label: key('High') },
  { value: 'xhigh', label: key('Very high') },
  { value: 'max', label: key('The most it can') },
]

export class Offered {
  /** The ids on offer, in family order. Empty until a key has answered. */
  models = $state<string[]>([])
  /** The one line under the field: what is happening, or what went wrong. Empty
   *  when there is nothing to say, and the pane then says what the key is for. */
  said = $state('')

  constructor() {
    // A pane opened with a key already set: ask at once, so the model select is
    // there rather than appearing a second later.
    if (glassesKey.set) void this.ask()
  }

  /** A key the reader typed or pasted. Set first, then asked with. */
  async take(given: string): Promise<void> {
    this.models = []

    const key = given.trim()
    if (!key) {
      this.said = ''
      return
    }

    this.said = t('Saving the key')
    const wrong = await glassesKey.put(key)
    if (wrong) {
      this.said = t(wrong)
      return
    }

    await this.ask()
  }

  /** Takes the key away, and the models with it: they were that key's. */
  async remove(): Promise<void> {
    await glassesKey.remove()
    this.models = []
    this.said = ''
  }

  private async ask(): Promise<void> {
    const token = account.accountToken
    if (!token) return

    this.said = t('Asking OpenAI which models this key can use')

    let found: string[]
    try {
      found = (await api.askModels(token)).models
    } catch (error) {
      // A phone with no signal, an account signed out, Nib being unreachable: all
      // of them are "no models", and the reader needs the reason rather than an
      // empty select.
      this.said = error instanceof Error ? error.message : t('Could not reach OpenAI')
      return
    }

    this.models = found
    if (!found.length) {
      this.said = t('That key cannot use any of the models nibeditor asks for.')
      return
    }

    this.said = ''
    // Nothing chosen yet, or a model that is no longer offered: take the first,
    // which is the newest family. A select with nothing in it is a question the
    // reader cannot answer.
    if (!found.includes(modes.glassesModel)) modes.setGlassesModel(found[0] ?? '')
  }
}
