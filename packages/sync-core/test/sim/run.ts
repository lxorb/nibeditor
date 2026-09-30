/** One simulated run: some devices, one account, one network, one clock, all driven
 *  by one seed (docs/sync-v2.md section 12).
 *
 *  A run is a list of steps, scripted or drawn at random from the seed: people type,
 *  cut, drop paragraphs, make, rename, move and delete notes and folders, append to
 *  the day's note, edit a file with another program, save; devices go offline and come
 *  back, quit, crash and start again, run their passes, and answer the modal. Then the
 *  network is healed and the run goes quiet: every device passes until nothing
 *  changes, answering whatever it holds. And then the checks in checks.ts judge what
 *  everybody ended up with.
 *
 *  The account and the devices are the reference ones in this folder unless a caller
 *  hands in its own through `account` and `device`: that is how the Worker's and the
 *  engine's lanes run these same seeds against their code. */

import { type Plant, ReferenceAccount, type Seeded } from './account'
import type {
  AccountAdapter,
  AccountView,
  Action,
  Answer,
  Classification,
  DeviceAdapter,
  Link,
  View,
} from './adapters'
import { judge, type Ledger, ledger, markersIn } from './checks'
import { ReferenceDevice } from './device'
import { CALM, Clock, type Faults, Network } from './network'
import { Random } from './random'

/** One thing that happens in a run. `device` is an index into the run's devices. */
export type Step =
  | { t: 'act'; device: number; action: Action }
  | { t: 'pass'; device: number }
  | { t: 'offline'; device: number }
  | { t: 'online'; device: number }
  | { t: 'quit'; device: number }
  | { t: 'crash'; device: number }
  | { t: 'launch'; device: number }
  | { t: 'answer'; device: number; choice: Answer }
  | { t: 'wait'; ticks: number }

export interface Options {
  seed: number
  devices?: number
  /** Steps drawn at random, when there is no script. */
  steps?: number
  script?: readonly Step[]
  faults?: Faults
  /** A rule the reference account breaks, to prove the checks notice. */
  plant?: Plant
  /** The notes every side starts with. */
  seeded?: readonly Seeded[]
  account?: (clock: Clock, seeded: readonly Seeded[]) => AccountAdapter
  device?: (id: string, clock: Clock, random: Random, seeded: readonly Seeded[]) => DeviceAdapter
  /** A marker to follow through the run, into the trace. */
  watch?: string
}

export interface Report {
  seed: number
  failures: string[]
  /** What happened, one line a step, for reading a failing seed. */
  trace: string[]
  /** What the account holds at the end. */
  account: AccountView
  /** How many times a device classified a merge, and how many of those it held. */
  classified: number
  held: number
}

/** The network the random walks run on: unkind, but not so unkind nothing gets through. */
export const ROUGH: Faults = { drop: 0.08, duplicate: 0.08, lostReply: 0.08, delay: [1, 25] }

const NAMES = ['Untitled.md', 'untitled.md', 'Plan.md', 'Notes.md', 'Café.md', 'café.md']
const FOLDERS = ['Work', 'work', 'Old']
const DAY = '2026-09-30.md'
const FILLER = ['the', 'plan', 'we', 'ship', 'on', 'monday', 'after', 'review', 'milk', 'eggs']

export const SEEDED: readonly Seeded[] = [
  { id: 'n1', name: 'Plan.md', text: 'We ship on Monday after the review.\n\n- milk\n- eggs\n' },
  { id: 'n2', name: 'Ideas.md', text: '# Ideas\n\nA long paragraph about what comes next.\n' },
]

/** Lets every continuation the network just woke run to its next wait. */
async function drain() {
  for (let turn = 0; turn < 64; turn++) await Promise.resolve()
}

class Run {
  readonly clock = new Clock()
  readonly random: Random
  readonly network: Network
  readonly account: AccountAdapter
  readonly devices: DeviceAdapter[]
  readonly book: Ledger
  readonly trace: string[] = []
  private readonly classifications: Classification[] = []
  private readonly passes = new Set<Promise<void>>()
  /** What each crashed device held when it went down. */
  private readonly beforeCrash = new Map<number, Set<string>>()
  private counter = 0

  constructor(private readonly options: Options) {
    this.random = new Random(options.seed)
    this.network = new Network(this.random, this.clock, options.faults ?? ROUGH)
    const seeded = options.seeded ?? SEEDED
    this.account = options.account
      ? options.account(this.clock, seeded)
      : new ReferenceAccount(this.clock, seeded, options.plant ?? null)
    this.devices = Array.from({ length: options.devices ?? 3 }, (_, index) => {
      const id = `d${String(index)}`
      const stream = new Random(this.random.int(2 ** 31))
      return options.device
        ? options.device(id, this.clock, stream, seeded)
        : new ReferenceDevice(id, this.clock, stream, seeded, this.random.between(-500, 500))
    })
    this.book = ledger(seeded.map((note) => note.id))
    for (const note of seeded)
      for (const marker of markersIn(note.text)) this.book.typed.add(marker)
  }

  private link(device: DeviceAdapter): Link {
    return (route, body) =>
      this.network.request(device.id, () => this.account.handle(device.id, route, body))
  }

  /** Words to type: a few common ones, so edits meet, and one marker to follow. */
  private words(): string {
    this.counter += 1
    const filler = Array.from(
      { length: this.random.between(0, 4) },
      () => this.random.pick(FILLER) ?? 'the',
    )
    const at = this.random.int(filler.length + 1)
    filler.splice(at, 0, `mk${String(this.counter)}z`)
    return filler.join(' ')
  }

  private action(): Action {
    const r = this.random
    const pick = () => r.next()
    const kind = r.weighted<Action['t']>([
      ['type', 30],
      ['cut', 6],
      ['drop-paragraph', 3],
      ['create', 8],
      ['mkdir', 3],
      ['rename', 6],
      ['move', 4],
      ['delete', 4],
      ['append-day', 6],
      ['edit-file', 5],
      ['save', 10],
    ])
    switch (kind) {
      case 'type':
        return { t: 'type', note: pick(), at: pick(), words: this.words() }
      case 'cut':
        return { t: 'cut', note: pick(), at: pick(), length: r.between(1, 30) }
      case 'drop-paragraph':
        return { t: 'drop-paragraph', note: pick(), at: pick() }
      case 'create':
        return {
          t: 'create',
          folder: r.chance(0.3) ? pick() : null,
          name: r.pick(NAMES) ?? 'Untitled.md',
          words: this.words(),
        }
      case 'mkdir':
        return {
          t: 'mkdir',
          folder: r.chance(0.3) ? pick() : null,
          name: r.pick(FOLDERS) ?? 'Work',
        }
      case 'rename':
        return { t: 'rename', target: pick(), name: r.pick([...NAMES, ...FOLDERS]) ?? 'Plan.md' }
      case 'move':
        return { t: 'move', target: pick(), folder: r.chance(0.4) ? null : pick() }
      case 'delete':
        return { t: 'delete', target: pick() }
      case 'append-day':
        return { t: 'append-day', name: DAY, words: this.words() }
      case 'edit-file':
        return {
          t: 'edit-file',
          note: pick(),
          at: pick(),
          words: this.words(),
          cut: r.between(0, 20),
        }
      case 'save':
        return { t: 'save' }
    }
  }

  /** A step drawn from the seed. */
  private drawn(): Step {
    const r = this.random
    const device = r.int(this.devices.length)
    const one = this.devices[device]
    if (one && !one.running)
      return r.chance(0.5) ? { t: 'launch', device } : { t: 'wait', ticks: r.between(1, 10) }
    if (one?.held().length)
      return { t: 'answer', device, choice: r.pick(['mine', 'theirs', 'both'] as const) ?? 'mine' }

    return r.weighted<Step>([
      [{ t: 'act', device, action: this.action() }, 60],
      [{ t: 'pass', device }, 20],
      [{ t: 'wait', ticks: r.between(1, 30) }, 10],
      [
        this.network.isOffline(one?.id ?? '') ? { t: 'online', device } : { t: 'offline', device },
        4,
      ],
      [{ t: 'crash', device }, 2],
      [{ t: 'quit', device }, 2],
    ])
  }

  /** Every marker a device shows or holds. */
  private async markersOf(device: DeviceAdapter): Promise<Set<string>> {
    const view = await device.view()
    const texts = [...Object.values(view.texts), ...device.held().map((held) => held.local)]
    return new Set(texts.flatMap(markersIn))
  }

  private async idsOf(device: DeviceAdapter): Promise<Set<string>> {
    return new Set((await device.view()).entries.map((entry) => entry.id))
  }

  private startPass(device: DeviceAdapter) {
    const pass = device.pass(this.link(device)).finally(() => this.passes.delete(pass))
    this.passes.add(pass)
  }

  private async step(step: Step) {
    const device = 'device' in step ? this.devices[step.device] : undefined
    this.trace.push(`${String(this.clock.now)} ${JSON.stringify(step)}`)

    switch (step.t) {
      case 'act': {
        if (!device?.running) break
        const before = await this.markersOf(device)
        const idsBefore = await this.idsOf(device)
        await device.act(step.action)
        const after = await this.markersOf(device)
        for (const marker of after) if (!before.has(marker)) this.book.typed.add(marker)
        // Taken out by the person, who could see them.
        for (const marker of before) if (!after.has(marker)) this.book.retired.add(marker)
        for (const id of await this.idsOf(device)) if (!idsBefore.has(id)) this.book.made.add(id)
        break
      }
      case 'answer': {
        const held = device?.held()[0]
        if (!device || !held) break
        const idsBefore = await this.idsOf(device)
        await device.answer(held.id, step.choice)
        for (const id of await this.idsOf(device)) if (!idsBefore.has(id)) this.book.made.add(id)
        break
      }
      case 'pass':
        if (device?.running) this.startPass(device)
        break
      case 'offline':
      case 'online':
        if (device) this.network.setOffline(device.id, step.t === 'offline')
        break
      case 'quit':
        if (device?.running) await device.quit()
        break
      case 'crash':
        if (device?.running) {
          this.beforeCrash.set(step.device, await this.markersOf(device))
          await device.crash()
        }
        break
      case 'launch': {
        if (!device || device.running) break
        await device.launch()
        const before = this.beforeCrash.get(step.device)
        this.beforeCrash.delete(step.device)
        if (before) {
          const after = await this.markersOf(device)
          for (const marker of before) if (!after.has(marker)) this.book.lost.add(marker)
        }
        break
      }
      case 'wait':
        for (let tick = 0; tick < step.ticks; tick++) await this.tick()
        break
    }

    for (const one of this.devices) this.classifications.push(...one.classified())
    await this.tick()
  }

  private async tick() {
    this.clock.advance(1)
    await this.network.deliver()
    await drain()
    if (this.options.watch) await this.follow(this.options.watch)
  }

  private followed = ''

  /** Where one marker is, written into the trace whenever that changes: the way to
   *  read a failing seed. */
  private async follow(marker: string) {
    const where: string[] = []
    const account = await this.account.view()
    for (const [id, text] of Object.entries(account.texts)) {
      if (text.includes(marker)) where.push(`account:${id}=${JSON.stringify(text)}`)
    }
    if (account.versions.some((text) => text.includes(marker))) where.push('account:version')
    for (const device of this.devices) {
      const view = await device.view()
      for (const [id, text] of Object.entries(view.texts)) {
        if (text.includes(marker)) where.push(`${device.id}:${id}`)
      }
      for (const held of device.held()) {
        if (held.local.includes(marker)) where.push(`${device.id}:held:${held.id}`)
      }
    }
    const now = where.join(' ')
    if (now !== this.followed) {
      this.trace.push(`   ${String(this.clock.now)} ${marker} at ${now || 'nowhere'}`)
      this.followed = now
    }
  }

  /** Heals the network and passes until nothing changes: every device online and
   *  running, every held note answered, every pass finished, twice over with nothing
   *  moving. */
  private async quiet(): Promise<boolean> {
    this.network.faults = CALM
    for (const [index, device] of this.devices.entries()) {
      this.network.setOffline(device.id, false)
      if (!device.running) await this.step({ t: 'launch', device: index })
    }

    let still = 0
    let last = ''
    for (let round = 0; round < 60; round++) {
      for (const [index, device] of this.devices.entries()) {
        for (let left = device.held().length; left > 0; left--) {
          const choice = this.random.pick(['mine', 'theirs', 'both'] as const) ?? 'mine'
          await this.step({ t: 'answer', device: index, choice })
        }
      }
      for (const device of this.devices) this.startPass(device)
      for (let guard = 0; guard < 10_000 && (this.passes.size || !this.network.quiet()); guard++) {
        await this.tick()
      }
      for (const one of this.devices) this.classifications.push(...one.classified())

      const views = await Promise.all(this.devices.map((device) => device.view()))
      const now = JSON.stringify([
        await this.account.view(),
        views,
        this.devices.map((device) => device.held().length),
      ])
      still = now === last ? still + 1 : 0
      last = now
      if (still >= 2) return true
    }
    return false
  }

  async run(): Promise<Report> {
    const script = this.options.script
    if (script) for (const step of script) await this.step(step)
    else for (let at = 0; at < (this.options.steps ?? 60); at++) await this.step(this.drawn())

    const failures: string[] = []
    if (!(await this.quiet())) failures.push('never went quiet')

    const account = await this.account.view()
    const devices: (View & { id: string })[] = []
    for (const device of this.devices) devices.push({ ...(await device.view()), id: device.id })
    failures.push(...judge(this.book, account, devices, this.classifications))
    return {
      seed: this.options.seed,
      failures,
      trace: this.trace,
      account,
      classified: this.classifications.length,
      held: this.classifications.filter((one) => one.held).length,
    }
  }
}

/** Runs one seed, or one script, and judges it. */
export function simulate(options: Options): Promise<Report> {
  return new Run(options).run()
}
