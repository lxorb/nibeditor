/** The one socket this device keeps to its account's hub.
 *
 *  Every signed-in device holds one, whether or not its web logins travel: it is where
 *  the account pokes a device about a space that moved (sync v2's engine listens for
 *  `poke`), where a web login is leased (web-tab/lease.svelte.ts), and where a new
 *  computer asks for the web key. One per device and not one per window: the hub
 *  replaces a device's socket when a second one arrives, so two windows each holding
 *  one would take it from each other for ever. So the first window to ask holds it - a
 *  Web Lock, which the next window inherits the moment this one goes - and every other
 *  window speaks through that one over a channel, hearing what it hears.
 *
 *  What it sends: `hello` as it opens (this device's id, its name, its platform, the
 *  app's version, and its public key once web logins travel), `beat` every ten seconds,
 *  which the service answers without waking the hub, and whatever a listener asks to
 *  send. What it hears is read at the boundary (hub-frames.ts) and handed to whoever
 *  asked with `on`. It comes back on its own after a drop, the way a room's socket does,
 *  and goes when the session does. See docs/sync-v2.md sections 5.12, 6.2 and 7. */

import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { BASE } from '../api'
import { BEAT_EVERY, roomDelay } from '../backoff'
import { t } from '../i18n.svelte'
import { keep, storedText } from '../stored'
import { invoke, isDesktop, platform } from '../tauri'
import {
  BEAT,
  DEVICE,
  readHubFrame,
  type FromDevice,
  type FromHub,
  type HubFrame,
  type HubType,
} from './hub-frames'

export type HubState = 'off' | 'connecting' | 'open'

/** The two close codes that mean another socket will not do: the session was ended on
 *  the account, or this device was. A new token is what brings the socket back. */
const ENDED = 1008

/** A socket, as much of it as the hub uses, so a test can hand in its own. */
export interface HubSocket {
  readonly open: boolean
  send(text: string): void
  /** Closes it on purpose: nothing it says after this is heard. */
  close(): void
}

/** What a socket says, to whoever opened it. */
export interface SocketEvents {
  opened(): void
  heard(text: string): void
  closed(code: number): void
}

/** A channel to this device's other windows, likewise. */
export interface HubChannel {
  post(message: unknown): void
}

/** What the hub needs from the world around it. The app's is `nativeWorld`; a test
 *  hands in its own. */
export interface HubWorld {
  socket(url: string, protocols: string[], events: SocketEvents): HubSocket
  /** This device's id for the account signed in now. */
  device(): Promise<string>
  /** What this device calls itself. */
  name(): Promise<string>
  /** A channel to this device's other windows, or none where there is one window. */
  channel(heard: (message: unknown) => void): HubChannel | null
  /** Runs `lead` once this window is the one that holds the socket: at once where there
   *  is nothing to share it with. */
  elect(lead: () => void): void
  /** A clock that ticks every `ms` whether or not the window is on screen; see
   *  `ticking`. Answers how to stop it. */
  every(ms: number, tick: () => void): () => void
}

/** What a window says to the others. */
type Relayed =
  | { k: 'frame'; frame: FromHub }
  | { k: 'state'; state: HubState }
  | { k: 'opened' }
  | { k: 'send'; frame: FromDevice }
  | { k: 'ask' }

/** What `introduce` adds to `hello`: the public key, once web logins travel. */
export interface Introduction {
  pub?: string
}

type Listener = (frame: FromHub) => void

export class Hub {
  /** Whether the hub can be spoken to: `open` once the socket is up and `hello` has
   *  gone, in whichever window holds it. */
  state = $state<HubState>('off')
  /** This device's id, once known. */
  device: string | null = null

  private token: string | null = null
  private socket: HubSocket | null = null
  private tries = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private stopBeat: (() => void) | null = null
  /** Whether this window holds the socket; the others relay. */
  private leading = false
  private electing = false
  private channel: HubChannel | null = null
  private introduction: (() => Promise<Introduction>) | null = null
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who is listening; nothing renders from it
  private readonly listeners = new Map<HubType, Set<Listener>>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly openers = new Set<() => void>()

  constructor(private readonly world: HubWorld) {}

  /** Follows the session from now on: a socket while somebody is signed in, none
   *  otherwise. Called once, after the first paint; see App.svelte. */
  start(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const token = account.signedIn ? account.token : null
        untrack(() => this.follow(token))
      })
    })
  }

  /** The session this device is signed in with, or none. */
  follow(token: string | null): void {
    if (token === this.token) return
    this.token = token
    this.join()

    if (!this.leading) {
      this.elect()
      return
    }
    this.drop()
    if (token) this.connect()
  }

  /** Hears one kind of frame from the hub. Answers how to stop. */
  on<T extends HubType>(type: T, listener: (frame: HubFrame<T>) => void): () => void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
    const all = this.listeners.get(type) ?? new Set<Listener>()
    this.listeners.set(type, all)
    // Every frame of this kind is this kind: `hear` hands each only to its own `t`.
    const one = listener as Listener
    all.add(one)
    return () => all.delete(one)
  }

  /** Runs every time the hub is spoken to afresh: after `hello`, on every connect and
   *  reconnect, which is when whatever this device holds has to be said again. */
  opened(run: () => void): () => void {
    this.openers.add(run)
    return () => this.openers.delete(run)
  }

  /** Whether this window is the one holding the socket: what says the device's own
   *  things - that somebody is at it, the road to the web key - once rather than once a
   *  window. */
  get leads(): boolean {
    return this.leading
  }

  /** Says something to the hub. Answers whether it went; a frame that could not go is
   *  not kept, because everything worth saying is said again when the hub is back. */
  send(frame: FromDevice): boolean {
    if (this.state !== 'open') return false
    if (!this.leading) {
      this.channel?.post({ k: 'send', frame } satisfies Relayed)
      return true
    }
    return this.write(JSON.stringify(frame))
  }

  /** What `hello` carries besides the device itself; said again at once if the socket
   *  is already up. */
  introduce(introduction: () => Promise<Introduction>): void {
    this.introduction = introduction
    if (this.leading && this.state === 'open') void this.hello()
  }

  /** Joins the other windows' channel, once. */
  private join(): void {
    if (this.channel) return
    this.channel = this.world.channel((message) => {
      this.relayed(message as Relayed)
    })
  }

  /** Asks to be the window that holds the socket, once. */
  private elect(): void {
    if (this.electing) return
    this.electing = true
    this.world.elect(() => {
      this.leading = true
      if (this.token) this.connect()
    })
    // Until then this window is somebody else's listener: ask where things stand.
    this.channel?.post({ k: 'ask' } satisfies Relayed)
  }

  private relayed(said: Relayed): void {
    if (this.leading) {
      if (said.k === 'send' && this.state === 'open') this.write(JSON.stringify(said.frame))
      if (said.k === 'ask') this.channel?.post({ k: 'state', state: this.state } satisfies Relayed)
      return
    }

    if (said.k === 'frame') this.hear(said.frame)
    else if (said.k === 'state') this.state = said.state
    else if (said.k === 'opened') {
      this.state = 'open'
      this.announce()
    }
  }

  private connect(): void {
    const token = this.token
    if (!token || this.socket) return
    this.setState('connecting')

    void this.world.device().then(
      (device) => {
        if (this.token !== token || this.socket) return
        this.device = device
        this.open(token, device)
      },
      () => {
        this.again()
      },
    )
  }

  private open(token: string, device: string): void {
    const url = `${BASE.replace(/^http/, 'ws')}/v2/hub`
    let socket: HubSocket | null = null
    try {
      socket = this.world.socket(url, [`nib.token.${token}`, `nib.device.${device}`], {
        opened: () => {
          this.tries = 0
          void this.hello()
          this.stopBeat?.()
          this.stopBeat = this.world.every(BEAT_EVERY, () => this.write(BEAT))
        },
        heard: (text) => {
          const frame = readHubFrame(text)
          if (!frame) return
          this.hear(frame)
          this.channel?.post({ k: 'frame', frame } satisfies Relayed)
        },
        closed: (code) => {
          if (this.socket !== socket) return
          this.socket = null
          this.stopBeat?.()
          this.stopBeat = null
          this.setState('off')
          // Ended on the account: nothing comes back until the session does.
          if (code !== ENDED) this.again()
        },
      })
    } catch {
      this.again()
      return
    }
    this.socket = socket
  }

  /** Says who this device is, and only then is the hub open: nothing but `hello` is
   *  acted on before it. */
  private async hello(): Promise<void> {
    const device = this.device
    if (!device) return

    const extra: Introduction = (await this.introduction?.().catch(() => ({}))) ?? {}
    const name = await this.world.name().catch(() => '')
    const sent = this.write(
      JSON.stringify({
        t: 'hello',
        device,
        name: name || platform() || 'nib',
        platform: platform() || 'web',
        app: __APP_VERSION__,
        ...(extra.pub ? { pub: extra.pub } : {}),
      } satisfies FromDevice),
    )
    if (!sent) return

    this.setState('open')
    this.channel?.post({ k: 'opened' } satisfies Relayed)
    this.announce()
  }

  private announce(): void {
    for (const run of this.openers) run()
  }

  private hear(frame: FromHub): void {
    for (const listener of this.listeners.get(frame.t) ?? []) listener(frame)
  }

  private write(text: string): boolean {
    const socket = this.socket
    if (!socket?.open) return false
    try {
      socket.send(text)
      return true
    } catch {
      // Closing under us; its close handler brings the next one.
      return false
    }
  }

  private setState(state: HubState): void {
    this.state = state
    this.channel?.post({ k: 'state', state } satisfies Relayed)
  }

  private again(): void {
    if (!this.token || this.retry) return
    this.tries++
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.connect()
    }, roomDelay(this.tries))
  }

  /** The socket closed on purpose, with nothing to come back. */
  private drop(): void {
    clearTimeout(this.retry)
    this.retry = undefined
    this.tries = 0
    this.stopBeat?.()
    this.stopBeat = null

    const socket = this.socket
    this.socket = null
    socket?.close()
    this.setState('off')
  }
}

/** A device id this device made for itself, for a session the sync store is not open
 *  for: a guest's, or a build with no store. Kept, so the hub sees one device. */
const MADE_ID = 'nib:hub-device'

function madeId(): string {
  const held = storedText(MADE_ID)
  if (held && DEVICE.test(held)) return held

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const made = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  keep(MADE_ID, made)
  return made
}

/** This device's id: the one the account's sync store keeps (section 9.2), which is
 *  the id the engine's documents are written under too, else one of its own. */
export async function deviceId(): Promise<string> {
  const user = account.user
  if (user) {
    try {
      const { openSyncStore } = await import('./store')
      const { device } = (await openSyncStore(user.id)).opened
      if (DEVICE.test(device)) return device
    } catch {
      // No store to be had here; the device's own id stands in.
    }
  }
  return madeId()
}

/** What this device calls itself: the name a person gave the computer where the system
 *  keeps one worth showing (a Mac's), else the platform, the way a caret names it. */
async function deviceName(): Promise<string> {
  if (isDesktop) {
    const named = await invoke<unknown>('device_name').catch(() => null)
    if (typeof named === 'string' && named.trim()) return named.trim()
  }
  const { deviceName: platformName } = await import('../rooms/who')
  return platformName(t('Browser'))
}

/** A clock that is not slowed while the window is hidden. A browser throttles a hidden
 *  page's own timers to once a minute after a few minutes, and a hub that hears one
 *  beat a minute counts the device gone after thirty seconds - so a minimised window
 *  would lose every web login it holds. A worker's timers are not throttled that way,
 *  so the beat is kept by one, and the page's own timer is what is left where there is
 *  no worker. */
function ticking(ms: number, tick: () => void): () => void {
  if (typeof Worker === 'function' && typeof URL.createObjectURL === 'function') {
    try {
      const source = `setInterval(() => postMessage(0), ${String(ms)})`
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const worker = new Worker(url)
      URL.revokeObjectURL(url)
      worker.onmessage = tick
      return () => worker.terminate()
    } catch {
      // A policy that refuses a worker: the page's own clock.
    }
  }
  const timer = setInterval(tick, ms)
  return () => clearInterval(timer)
}

/** The app's world: a real socket, the sync store's id, the other windows over a
 *  channel and a Web Lock deciding which of them holds the socket. */
const nativeWorld: HubWorld = {
  socket: (url, protocols, events) => {
    const socket = new WebSocket(url, protocols)
    socket.onopen = () => {
      events.opened()
    }
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') events.heard(event.data)
    }
    socket.onclose = (event) => {
      events.closed(event.code)
    }
    // A socket that failed to open reports an error and then a close, and the close is
    // what brings the next one.
    socket.onerror = () => undefined
    return {
      get open() {
        return socket.readyState === WebSocket.OPEN
      },
      send: (text) => {
        socket.send(text)
      },
      close: () => {
        // Closing on purpose is nothing to come back from: the handlers go first.
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.close()
      },
    }
  },
  device: deviceId,
  name: deviceName,
  channel: (heard) => {
    if (typeof BroadcastChannel !== 'function') return null
    const channel = new BroadcastChannel('nib:hub')
    channel.onmessage = (event: MessageEvent<unknown>) => {
      heard(event.data)
    }
    return { post: (message) => channel.postMessage(message) }
  },
  elect: (lead) => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      lead()
      return
    }
    // Held for the window's life: the promise never settles, and the lock goes with
    // the window, which is when the next one in line takes it.
    void locks.request('nib:hub', () => {
      lead()
      return new Promise<never>(() => undefined)
    })
  },
  every: ticking,
}

export const hub = new Hub(nativeWorld)
