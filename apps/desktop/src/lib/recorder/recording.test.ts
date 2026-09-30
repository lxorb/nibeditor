import { beforeEach, expect, test, vi } from 'vitest'

/** Stop, pressed while the microphone is still being opened.
 *
 *  The pill is up and offers its stop from the moment Record is pressed, and opening a
 *  microphone takes as long as the system takes to ask and to answer - seconds, on a
 *  machine that is busy. A stop pressed in that time was dropped: nothing was holding
 *  the microphone yet, so there was nothing to stop, and when the microphone did open
 *  the recording began anyway and ran until somebody pressed stop a second time. Every
 *  recorder a person has used - Voice Memos, a phone's own - stops when it is told to.
 *
 *  The microphone and the note are stood in for: what is under test is the order the
 *  store does things in. */

let opening: ((held: { stop: () => Promise<unknown>; extension: string }) => void) | null = null
const stopped: string[] = []

vi.mock('./microphone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./microphone')>()),
  record: () =>
    new Promise((resolve) => {
      opening = resolve
    }),
}))

vi.mock('./note', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./note')>()),
  noteToRecordInto: () => Promise.resolve('/space/Recordings.md'),
}))

const { recorder } = await import('./recording.svelte')

beforeEach(() => {
  opening = null
  stopped.length = 0
})

test('a stop pressed while the microphone opens stops it as soon as it is open', async () => {
  void recorder.start('note')
  await vi.waitFor(() => expect(opening).not.toBeNull())

  // Pressed on the pill before the system has handed the microphone over.
  void recorder.stop()

  opening?.({
    stop: () => {
      stopped.push('stopped')
      return Promise.resolve({ bytes: new ArrayBuffer(0), seconds: 0, spare: null })
    },
    extension: 'weba',
  })

  await vi.waitFor(() => expect(stopped).toEqual(['stopped']))
  expect(recorder.on).toBe(false)
})
