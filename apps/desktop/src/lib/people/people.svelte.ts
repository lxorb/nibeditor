/** Everybody the app has drawn a face for: the one place a surface asks who somebody is,
 *  what they look like, whether they are here and what they are called in a space.
 *
 *  `people.of(id)` answers at once with what is known and asks the service for the rest:
 *  every id asked for in one turn goes in one request, so a list of forty people is one
 *  round trip, and a surface simply draws again when the answer lands. The account's own
 *  profile is never asked for; it is the account (`/v1/me`), so a change made here shows
 *  everywhere at once. Whether somebody is here is asked again each minute for the people
 *  some surface is watching (`watch`), and never for anybody else. See docs/chats.md 4.9,
 *  4.10 and 6.1. */

import { account } from '../account.svelte'
import { PRESENCE_EVERY } from '../backoff'
import { fetchNicks, fetchPeople, fetchPresence } from './calls'
import type { Presence } from './face'
import type { Person } from './read'

/** How many ids go in one request: the most the service answers at once. */
const AT_ONCE = 200

class People {
  /** Everybody the service has told this device about, by id. */
  known = $state<Record<string, Person>>({})
  /** What each person is called in a space, where they chose something, by space id. */
  nicknames = $state<Record<string, Record<string, string>>>({})

  /** The account's own card, out of the account itself. */
  readonly mine = $derived.by((): Person | null => {
    const user = account.user
    if (!user) return null
    return {
      id: user.id,
      name: account.name ?? '',
      avatar: user.avatar ?? null,
      accent: user.accent ?? null,
      pronouns: user.pronouns ?? null,
      bio: user.bio ?? null,
      status: user.status ?? null,
      zone: user.zone ?? null,
      presence: user.hidden ? 'offline' : 'active',
    }
  })

  // Plain fields: what has been asked for and who is watching, which nothing draws
  // from. Reading the reactive record above and writing these is what lets `of` be
  // called from a template, a derived or an effect without running away; see
  // docs/conventions.md.
  private readonly asked = new Set<string>()
  private readonly waiting = new Set<string>()
  private readonly spacesAsked = new Set<string>()
  private readonly watchers = new Set<() => readonly string[]>()
  private ticking: ReturnType<typeof setInterval> | undefined

  constructor() {
    account.forgetWithSession(() => this.forget())
  }

  /** Somebody, by account id: what is known now, and asked for if nothing is. */
  of(id: string): Person | undefined {
    const mine = this.mine
    if (mine?.id === id) return mine

    const known = this.known[id]
    if (!known) this.ask(id)
    return known
  }

  /** What to call somebody: their name in this space where they chose one there, else
   *  their name. */
  called(id: string, space?: string | null): string | undefined {
    if (space) {
      const own = this.mine?.id === id ? account.user?.nicks?.[space] : undefined
      const nick = own ?? this.nickIn(space)[id]
      if (nick) return nick
    }
    return this.of(id)?.name
  }

  /** Every nickname in a space, asked for once. */
  nickIn(space: string): Record<string, string> {
    if (!this.spacesAsked.has(space)) {
      this.spacesAsked.add(space)
      queueMicrotask(() => void this.askNicks(space))
    }
    return this.nicknames[space] ?? {}
  }

  /** Keeps whether these people are here up to date while it runs: asked at once and
   *  then each minute, while the window is on screen. Answers how to stop. */
  watch(ids: () => readonly string[]): () => void {
    this.watchers.add(ids)
    queueMicrotask(() => void this.tick())
    this.ticking ??= setInterval(() => void this.tick(), PRESENCE_EVERY)
    return () => {
      this.watchers.delete(ids)
      if (this.watchers.size || this.ticking === undefined) return
      clearInterval(this.ticking)
      this.ticking = undefined
    }
  }

  private ask(id: string): void {
    if (this.asked.has(id) || !id) return
    this.asked.add(id)
    this.waiting.add(id)
    if (this.waiting.size === 1) queueMicrotask(() => void this.flush())
  }

  private async flush(): Promise<void> {
    const ids = [...this.waiting]
    this.waiting.clear()
    const token = account.accountToken
    if (!token) {
      for (const id of ids) this.asked.delete(id)
      return
    }

    for (let at = 0; at < ids.length; at += AT_ONCE) {
      const chunk = ids.slice(at, at + AT_ONCE)
      try {
        const found = await fetchPeople(token, chunk)
        if (account.accountToken !== token) return
        this.known = { ...this.known, ...Object.fromEntries(found.map((one) => [one.id, one])) }
      } catch {
        // Nobody to draw but the initial a row already has; asked again in a minute,
        // rather than by the next frame that draws the row.
        setTimeout(() => {
          for (const id of chunk) this.asked.delete(id)
        }, PRESENCE_EVERY)
      }
    }
  }

  private async askNicks(space: string): Promise<void> {
    const token = account.accountToken
    if (!token) {
      this.spacesAsked.delete(space)
      return
    }
    try {
      const nicks = await fetchNicks(token, space)
      if (account.accountToken === token) this.nicknames = { ...this.nicknames, [space]: nicks }
    } catch {
      // The names people have everywhere stand in until the space is asked again.
      this.spacesAsked.delete(space)
    }
  }

  /** Whether each watched person is here, asked once for all of them. */
  private async tick(): Promise<void> {
    const token = account.accountToken
    if (!token || (typeof document !== 'undefined' && document.hidden)) return

    const mine = this.mine?.id
    const ids = [...new Set([...this.watchers].flatMap((one) => one()))].filter((id) => id !== mine)
    if (!ids.length) return

    try {
      const said = await fetchPresence(token, ids.slice(0, AT_ONCE))
      this.heard(said)
    } catch {
      // What was known stands until the next minute.
    }
  }

  private heard(said: Record<string, Presence>): void {
    let changed = false
    const next = { ...this.known }
    for (const [id, presence] of Object.entries(said)) {
      const known = next[id]
      if (!known || known.presence === presence) continue
      next[id] = { ...known, presence }
      changed = true
    }
    if (changed) this.known = next
  }

  /** The account changed: nothing known about anybody describes the next one's view. */
  private forget(): void {
    this.known = {}
    this.nicknames = {}
    this.asked.clear()
    this.waiting.clear()
    this.spacesAsked.clear()
  }
}

export const people = new People()
