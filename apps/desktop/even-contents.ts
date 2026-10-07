/** What may go into the Even Realities plugin, and how much of each.
 *
 *  The plugin is the app with the desktop left out, and the desktop grows every week.
 *  Leaving something out used to be found out at the 8 MiB ceiling, by whichever
 *  change happened to cross it, a long way from the change that brought the weight
 *  in. So the package is held to a list instead: every library, every package of
 *  ours and every folder of the app's that is in it is named here, and anything new
 *  fails src/lib/even/bundle.test.ts by name, in the change that brought it.
 *
 *  A new entry is a decision, not a fix for a red test. If the phone or the glasses
 *  need it, name it here. If not, leave it out where it comes in: a library in
 *  `LEFT_OUT` in vite.even.config.ts, a module of ours by a twin beside it
 *  (`x.even.ts`, see `twinOf` there), and only as a last resort a branch on
 *  `__EVEN_PLUGIN__`.
 *
 *  And the weight of each part of the package, in bytes as staged, with room to grow
 *  that adds up to well under the ceiling: a part that outgrows its budget says which
 *  part grew rather than that the package did. */

/** Libraries, by package name. */
export const LIBRARIES = [
  // The interface and its icons
  'svelte',
  'clsx',
  'lucide',
  'perfect-freehand',
  'uqr',
  // The glasses: the bridge, the firmware's metrics, the emoji it cannot draw
  '@evenrealities/even_hub_sdk',
  '@evenrealities/pretext',
  'node-emoji',
  'emojilib',
  'char-regex',
  'skin-tone',
  'unicode-emoji-modifier-base',
  // A note: markdown, its properties, its maths, pasting into it
  'marked',
  'yaml',
  'katex',
  'turndown',
  'turndown-plugin-gfm',
  '@sindresorhus/is',
  // Sync and rooms
  'yjs',
  'y-protocols',
  'lib0',
  // The calls a desktop answers, which the web build answers itself
  '@tauri-apps/api',
  '@tauri-apps/plugin-dialog',
  '@tauri-apps/plugin-opener',
  '@tauri-apps/plugin-process',
  // The editor
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/markdown',
  '@marijn/find-cluster-break',
  'crelt',
  'style-mod',
  'w3c-keyname',
  '@replit/codemirror-vim',
  '@replit/codemirror-vim-core',
  // A fence's colours, each fetched when a fence names its language
  '@codemirror/language-data',
  '@codemirror/legacy-modes',
  '@codemirror/lang-angular',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-go',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-jinja',
  '@codemirror/lang-json',
  '@codemirror/lang-less',
  '@codemirror/lang-liquid',
  '@codemirror/lang-markdown',
  '@codemirror/lang-php',
  '@codemirror/lang-python',
  '@codemirror/lang-rust',
  '@codemirror/lang-sass',
  '@codemirror/lang-sql',
  '@codemirror/lang-vue',
  '@codemirror/lang-wast',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
  '@lezer/cpp',
  '@lezer/css',
  '@lezer/go',
  '@lezer/html',
  '@lezer/java',
  '@lezer/javascript',
  '@lezer/json',
  '@lezer/php',
  '@lezer/python',
  '@lezer/rust',
  '@lezer/sass',
  '@lezer/xml',
  '@lezer/yaml',
  '@replit/codemirror-lang-nix',
  '@replit/codemirror-lang-solidity',
  '@replit/codemirror-lang-svelte',
  'codemirror-lang-elixir',
  'codemirror-lang-hcl',
  'lezer-elixir',
]

/** Our own packages, by their folder under packages/. */
export const PACKAGES = [
  'autocomplete',
  'bases',
  'editor',
  'glasses',
  'lang-html',
  'markdown',
  'rooms',
  'sync-core',
  'themes',
]

/** The app's own folders under src/lib. The files at the top of src/lib are the shell
 *  and are not listed one by one; the budget for code is what holds them. */
export const APP_FOLDERS = [
  'agents',
  'ai',
  'api',
  'automation',
  'back-swipe',
  'canvas',
  'even',
  'export',
  'foreign',
  'glass',
  'import',
  'mobile',
  'online',
  'pages',
  'palette',
  'pdf',
  'properties',
  'quick-add',
  'reading',
  'recorder',
  'reminders',
  'remote',
  'rooms',
  'rows',
  'save-place',
  'scratchpad',
  'search',
  'settings',
  'shortcuts',
  'slides',
  'sync',
  'sync2',
  'tab-fill',
  'tab-strip',
  'terminal',
  'theme-picker',
  'themes',
  'views',
  'wallpaper',
  'web',
  'web-tab',
  'workspace',
]

/** Where a module of the package comes from, as the lists above name it, or null for
 *  what the bundler and this build write themselves and for the app's own top level. */
export function sourceOf(module: string): string | null {
  const path = module.replace(/\\/g, '/')
  if (path.startsWith('\0')) return null

  const library = path.lastIndexOf('node_modules/')
  if (library >= 0) {
    const [scope = '', name = ''] = path.slice(library + 'node_modules/'.length).split('/')
    return `library ${scope.startsWith('@') ? `${scope}/${name}` : scope}`
  }

  const ours = /^packages\/([^/]+)\//.exec(path)
  if (ours) return `package ${ours[1]}`

  const folder = /^apps\/desktop\/src\/lib\/([^/?]+)\//.exec(path)
  return folder ? `folder ${folder[1]}` : null
}

/** Each part of the staged package, by what its files are. */
export type Part = 'catalogues' | 'code' | 'fonts' | 'styles' | 'pages'

/** The part a staged file belongs to. `catalogue` says whether a script is one of the
 *  interface's catalogues or the English they share. */
export function partOf(file: string, catalogue: boolean): Part {
  if (file.endsWith('.js')) return catalogue ? 'catalogues' : 'code'
  if (file.endsWith('.css')) return 'styles'
  if (/\.(woff2?|ttf)$/.test(file)) return 'fonts'
  return 'pages'
}

/** Bytes each part may weigh, as staged. Measured on 2026-10-07 at 5,297,926 for the
 *  code, 762,886 for the catalogues, 266,816 for the styles, 256,168 for the fonts and
 *  33,555 for the pages and the icon. The budgets add up to 7,040,000, so 1.29 MiB of
 *  the 8 MiB ceiling is out of every part's reach without a change to this table. */
export const BUDGETS: Record<Part, number> = {
  code: 5_600_000,
  catalogues: 850_000,
  styles: 290_000,
  fonts: 260_000,
  pages: 40_000,
}
