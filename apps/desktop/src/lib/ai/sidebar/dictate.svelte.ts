/** Dictation into the panel's field: ChatGPT's microphone, through nib's own road from
 *  sound to words (recorder/microphone.ts records, recorder/transcribe.ts hears it with
 *  the reader's provider or the account). Pressed once it listens, pressed again it
 *  stops, and the words land at the end of what is already in the field, for the reader
 *  to read over before sending: a dictated message is still a message somebody sends.
 *
 *  Fetched by the first press (and `/voice`), with the recorder behind it: the panel
 *  carries none of it until somebody speaks. */

import { message, t } from '../../i18n.svelte'
import type { Recording } from '../../recorder/microphone'
import { chat } from './chat.svelte'

export type Hearing = 'idle' | 'listening' | 'hearing'

class Dictation {
  /** Idle, the microphone open, or the recording being turned into words. */
  state = $state<Hearing>('idle')
  private running: Recording | null = null

  /** On, off, or the other of the two. */
  async toggle(on?: boolean): Promise<void> {
    const want = on ?? this.state === 'idle'
    if (want && this.state === 'idle') await this.start()
    else if (!want && this.state === 'listening') await this.finish()
  }

  private async start(): Promise<void> {
    this.state = 'listening'
    try {
      const { record } = await import('../../recorder/microphone')
      this.running = await record({ full: () => void this.finish() })
    } catch (error) {
      this.state = 'idle'
      chat.trouble = message(error, t('That recording could not be turned into words.'))
    }
  }

  private async finish(): Promise<void> {
    const running = this.running
    this.running = null
    if (!running) return
    this.state = 'hearing'
    try {
      const { bytes } = await running.stop()
      const { wordsInFile } = await import('../../recorder/transcribe')
      const said = (await wordsInFile(bytes)).text.trim()
      if (said) chat.text = chat.text.trim() ? `${chat.text.trimEnd()} ${said}` : said
      chat.focus()
    } catch (error) {
      chat.trouble = message(error, t('That recording could not be turned into words.'))
    } finally {
      this.state = 'idle'
    }
  }
}

export const dictation = new Dictation()
