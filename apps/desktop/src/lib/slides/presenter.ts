/** The window the presenter reads while the audience reads the other one.
 *
 *  Two windows on one origin, so they talk over a broadcast channel rather than
 *  through the app: the stage says what is up, the presenter's window says which
 *  way to go. That is the whole protocol, and it is the same one on a desktop
 *  and in a browser - the only difference is which of the two opens a window.
 *
 *  Nothing here is required for presenting. Every call that could be refused -
 *  a permission the packaged app has not been given, a popup a browser blocked,
 *  a machine with one screen - answers no, and the notes are then a sheet in the
 *  presenting window instead. */

import type { SlideShape } from '@nib/markdown/slides'
import type { Scheme } from '../theme.svelte'
import { invoke, isDesktop } from '../tauri'

/** Everything the presenter's window draws. Sent whole on every change rather
 *  than patched, because it is three short strings and a number. */
export interface Stage {
  /** The slide that is up, and the one after it. HTML, rendered by the stage. */
  slide: string
  next: string
  /** How each of the two is laid out, so the presenter sees the slide the
   *  audience sees rather than a second reading of the same words. */
  shape: SlideShape
  nextShape: SlideShape
  /** The notes for the slide that is up. */
  notes: string
  /** Which slide, counting from one, and how many there are. */
  at: number
  count: number
  /** When presenting began, so the clock runs in the other window rather than
   *  being told the time once a second. */
  started: number
  scheme: Scheme
}

export type Message =
  | { kind: 'stage'; stage: Stage }
  | { kind: 'move'; by: number }
  /** The presenter's window, saying it is on the page. A window opens when a
   *  deck is already up and nothing about the deck is about to change, so it
   *  would otherwise sit empty until the first press. */
  | { kind: 'here' }
  | { kind: 'gone' }

const CHANNEL = 'nib:presenter'
const LABEL = 'nib-presenter'

/** A message off the channel is a value from outside: checked once, here, and
 *  trusted by its type from then on. */
function messageOf(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>

  if (said.kind === 'gone') return { kind: 'gone' }
  if (said.kind === 'here') return { kind: 'here' }
  if (said.kind === 'move' && typeof said.by === 'number') return { kind: 'move', by: said.by }
  if (said.kind !== 'stage') return null

  const stage = said.stage
  if (typeof stage !== 'object' || stage === null) return null
  const one = stage as Record<string, unknown>

  if (typeof one.slide !== 'string' || typeof one.next !== 'string') return null
  if (typeof one.notes !== 'string' || typeof one.at !== 'number') return null
  if (typeof one.count !== 'number' || typeof one.started !== 'number') return null
  if (one.scheme !== 'dark' && one.scheme !== 'light') return null

  const shape = shapeOf(one.shape)
  const nextShape = shapeOf(one.nextShape)
  if (!shape || !nextShape) return null

  return {
    kind: 'stage',
    stage: {
      slide: one.slide,
      next: one.next,
      shape,
      nextShape,
      notes: one.notes,
      at: one.at,
      count: one.count,
      started: one.started,
      scheme: one.scheme,
    },
  }
}

const SHAPES: readonly SlideShape[] = ['title', 'picture', 'prose']

function shapeOf(value: unknown): SlideShape | null {
  return SHAPES.find((one) => one === value) ?? null
}

export interface Channel {
  send(message: Message): void
  close(): void
}

/** Both ends of the conversation use this. A browser that has no channel to
 *  offer - an old one, or a page with site data turned off - gets one that says
 *  nothing and hears nothing, which leaves presenting exactly as it was. */
export function presenterChannel(heard: (message: Message) => void): Channel {
  if (typeof BroadcastChannel === 'undefined') {
    return { send: () => undefined, close: () => undefined }
  }

  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = messageOf(event.data)
    if (message) heard(message)
  }

  return {
    send: (message) => channel.postMessage(message),
    close: () => channel.close(),
  }
}

/** How big the presenter's window opens. Wide enough for the slide, the one
 *  after it and the notes beside them. */
const WIDTH = 1100
const HEIGHT = 680

/** Whether there is a screen the audience is not looking at. A machine that
 *  will not say - a browser, or a packaged app that has not been given the
 *  permission - counts as one screen, and the notes stay a sheet. */
export async function secondScreen(): Promise<boolean> {
  if (!isDesktop) return false

  try {
    const { availableMonitors } = await import('@tauri-apps/api/window')
    return (await availableMonitors()).length > 1
  } catch {
    // Nothing is known about the screens, so nothing is assumed about them.
    return false
  }
}

/** Opens it, on a screen the presenting window is not on when there is one.
 *  Answers whether a window is up. */
export async function openPresenter(): Promise<boolean> {
  if (!isDesktop) return openTab()

  try {
    const [{ WebviewWindow }, { availableMonitors, currentMonitor }] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/window'),
    ])

    // Brought forward by the crate, which never does so in a run whose windows were
    // sent off the screen; see `raise_window` in src-tauri/src/placement.rs.
    const standing = await WebviewWindow.getByLabel(LABEL)
    if (standing) {
      await invoke('raise_window', { label: LABEL })
      return true
    }

    const [here, screens] = await Promise.all([
      currentMonitor().catch(() => null),
      availableMonitors().catch(() => []),
    ])
    // The screen the deck is not on, so the notes are not projected.
    const other = screens.find((screen) => screen.name !== here?.name) ?? here

    const window = new WebviewWindow(LABEL, {
      url: 'presenter.html',
      title: 'nibeditor',
      width: WIDTH,
      height: HEIGHT,
      ...(other ? { x: other.position.x + 40, y: other.position.y + 40 } : {}),
    })

    return await new Promise<boolean>((settle) => {
      void window.once('tauri://created', () => settle(true))
      void window.once('tauri://error', () => settle(false))
    })
  } catch {
    // The packaged app may not be allowed to open a window; presenting goes on
    // without one, and the notes are a sheet.
    return false
  }
}

/** In a browser it is a tab of its own, which only opens from a gesture - and
 *  Present is always one. A blocked popup answers no. */
function openTab(): boolean {
  const opened = window.open('presenter.html', LABEL, `width=${WIDTH},height=${HEIGHT}`)
  return opened !== null
}

export async function closePresenter(): Promise<void> {
  if (!isDesktop) return

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const standing = await WebviewWindow.getByLabel(LABEL)
    await standing?.close()
  } catch {
    // A window that cannot be closed from here closes when the app does.
  }
}
