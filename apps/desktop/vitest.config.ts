import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defaultExclude, defineConfig } from 'vitest/config'

/** Two projects, because there are two kinds of test here and only one of them
 *  can run an effect.
 *
 *  Almost everything is the first kind: a pure function, a store driven by hand, a
 *  catalogue read off the disk. Those want Node and nothing else, and they are fast
 *  because there is no page to build. But Vitest compiles a `.svelte.ts` the way
 *  the environment asks for, and `environment: 'node'` is Vite's `ssr` environment:
 *  the server build of a rune is not reactive, `$state` is a plain field there and
 *  `$effect` does not exist at all. So no test in that project can run an effect -
 *  which is how a store that read the state it wrote, from inside an `$effect`,
 *  reached an installed build and stopped the whole page from updating. See
 *  test/effects.
 *
 *  The second project is that one gap and nothing else: `environment: 'jsdom'`,
 *  which Vitest serves out of Vite's `client` environment, so the runes compile to
 *  the same code the app ships and `$effect`, `$effect.root`, `flushSync` and the
 *  loop guard behave as they do in the window. A real browser would answer the same
 *  questions - the scheduler is the same JavaScript either way - and would cost a
 *  browser download on every machine and every CI run to answer them. What these
 *  tests never ask about is layout or paint, which is the one thing jsdom cannot
 *  do. So jsdom, which this repository already had. */

/** The same wide margin in both projects. Nothing here asserts on time - the counts
 *  and the shapes are what say whether a test is right - and a timeout is only ever
 *  the wall the slowest honest run must not hit: the first test in a file pays for
 *  compiling the store graph it imports, on a cold cache, over whatever cores are
 *  left. */
const clocks = { hookTimeout: 30000, testTimeout: 30000 }

export default defineConfig({
  // The Svelte plugin is what compiles the runes in `.svelte.ts` stores.
  plugins: [svelte()],
  // The build stamps the first in and sets the second; a test is the app rather
  // than the plugin, and the one test that wants the plugin says so for itself.
  define: {
    __EVEN_BUILD__: JSON.stringify('under test'),
    __EVEN_PLUGIN__: 'false',
    __DRIVEABLE__: 'true',
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          // Vitest skips CSS by default, which makes the `?raw` imports the export
          // bakes into a document come back empty - the very thing under test.
          css: true,
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          // Everything but the effects, which the project below runs instead. The
          // defaults are spelled out again because naming an exclude replaces them.
          exclude: [...defaultExclude, '**/*.effect.test.ts'],
          environment: 'node',
          ...clocks,
        },
      },
      {
        extends: true,
        // The runes compile for the client on their own, because that is what the
        // environment below asks for; the runtime they call into does not. Vitest
        // resolves a dependency with Node's own conditions, and `svelte` answers
        // those with its server build - the one whose `mount` throws in as many
        // words. `browser` is the condition that build is behind. This project
        // only, so the node project resolves what it always did.
        resolve: { conditions: ['browser'] },
        test: {
          name: 'effects',
          include: ['src/**/*.effect.test.ts', 'test/**/*.effect.test.ts'],
          environment: 'jsdom',
          ...clocks,
        },
      },
    ],
  },
})
