/** A desktop's notices: what the crate is asked to show, and a press it heard answered
 *  by the notice it was on and by no other. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  asked: [] as { command: string; args: Record<string, unknown> | undefined }[],
  pressed: null as ((event: { payload: unknown }) => void) | null,
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, args })
    return Promise.resolve(null)
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, heard: (event: { payload: unknown }) => void) => {
    world.pressed = heard
    return Promise.resolve(() => undefined)
  },
}))

const { notify, show, unshow } = await import('./notify')

/** The id the crate was handed for the last notice shown. */
function lastId(): string {
  const notice = world.asked.at(-1)?.args?.notice as { id: string }
  return notice.id
}

const settled = () => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  world.asked.length = 0
})

describe('notices on a desktop', () => {
  it('hands the crate the words, the tag and the answer field', () => {
    show({
      title: 'Lucile',
      body: 'The figures are in',
      tag: 'c_1',
      from: '#thesis',
      silent: true,
      reply: { placeholder: 'Reply', send: 'Send', replied: () => undefined },
    })
    expect(world.asked[0]).toMatchObject({
      command: 'notice_show',
      args: {
        notice: {
          tag: 'c_1',
          title: 'Lucile',
          body: 'The figures are in',
          from: '#thesis',
          silent: true,
          reply: { placeholder: 'Reply', send: 'Send' },
        },
      },
    })
    expect(lastId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('answers a press with the notice it was on', async () => {
    const opened = vi.fn()
    const replied = vi.fn()
    show({
      title: 'a',
      body: 'b',
      tag: 'c_2',
      opened,
      reply: { placeholder: 'r', send: 's', replied },
    })
    const id = lastId()
    await settled()

    world.pressed?.({ payload: { id, act: 'reply', text: 'on it' } })
    world.pressed?.({ payload: { id, act: 'reply', text: '   ' } })
    world.pressed?.({ payload: { id, act: 'open' } })
    world.pressed?.({ payload: { id: 'somebody else', act: 'open' } })
    world.pressed?.({ payload: 'nonsense' })
    expect(replied.mock.calls).toEqual([['on it']])
    expect(opened).toHaveBeenCalledOnce()
  })

  it('lets a replaced notice go, and takes a tag back once', async () => {
    const first = vi.fn()
    const second = vi.fn()
    notify('a', 'b', 'c_3', first)
    const old = lastId()
    notify('a', 'b', 'c_3', second)
    const kept = lastId()
    await settled()

    world.pressed?.({ payload: { id: old, act: 'open' } })
    world.pressed?.({ payload: { id: kept, act: 'open' } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()

    unshow('c_3')
    unshow('c_3')
    expect(world.asked.filter((one) => one.command === 'notice_clear')).toEqual([
      { command: 'notice_clear', args: { tag: 'c_3' } },
    ])
  })
})
