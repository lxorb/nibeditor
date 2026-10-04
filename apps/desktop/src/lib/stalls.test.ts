import { describe, expect, it } from 'vitest'
import { described, fileOf } from './stalls'

const script = (invoker: string, name: string, url: string, at: number, duration: number) => ({
  invoker,
  sourceFunctionName: name,
  sourceURL: url,
  sourceCharPosition: at,
  took: duration,
})

describe('a stall in the log', () => {
  it('names the longest scripts by file, and what the page was waiting on', () => {
    const line = described(
      {
        startTime: 1200,
        took: 1843.6,
        scripts: [
          script(
            'TimerHandler:setTimeout',
            'fold',
            'http://tauri.localhost/assets/link-index-3bd2.js',
            4120,
            1610.2,
          ),
          script('Response.json.then', '', 'http://tauri.localhost/assets/index-a1.js?v=2', 88, 12),
          script(
            'Window.requestAnimationFrame',
            'tick',
            'http://tauri.localhost/assets/editor-9.js',
            7,
            120,
          ),
          script('IMG.onload', 'loaded', 'http://tauri.localhost/assets/x.js', 1, 5),
        ],
      },
      ['read_tree 2.1 s'],
    )

    expect(line).toBe(
      'stall: the page was blocked 1844 ms; ran TimerHandler:setTimeout fold link-index-3bd2.js:4120 1610 ms, ' +
        'Window.requestAnimationFrame tick editor-9.js:7 120 ms, Response.json.then - index-a1.js:88 12 ms; ' +
        'waiting on read_tree 2.1 s',
    )
  })

  it('says so when nothing it ran can be named, and leaves out an empty wait', () => {
    expect(described({ startTime: 0, took: 1000, scripts: [] }, [])).toBe(
      'stall: the page was blocked 1000 ms; ran nothing it could name',
    )
  })

  it('says an address by its last part only', () => {
    expect(fileOf('https://example.com/private/path/page.js?token=1#x')).toBe('page.js')
    expect(fileOf('IMG#avatar.onload')).toBe('IMG#avatar.onload')
    expect(fileOf('')).toBe('')
  })
})
