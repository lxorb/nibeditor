import { describe, expect, test } from 'vitest'
import { LanguageDescription, StringStream, type StreamParser } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { languages as stock } from '@codemirror/language-data'
import { htmlToMarkdown } from '@nib/markdown/from-html'
import { fenceLanguages } from './languages'
import { SPELLINGS } from './language-spellings'
import { DIAGRAM_LANGUAGES } from './live-preview/render'
import { isRunnableLanguage } from './run/run'
import { graphqlParser } from './graphql'
import { makefileParser } from './makefile'
import { mermaidParser } from './mermaid'
import { prismaParser } from './prisma'

/** The list, in hand. The app fetches it with the first fence that names a language;
 *  every test here is about what is in it, so it is awaited once and read as an array
 *  throughout. */
const languages = await fenceLanguages()

/** What a fence saying this word opens, the way `markdown()` asks it. */
const languageFor = (word: string) =>
  LanguageDescription.matchLanguageName(languages, word, true)?.name ?? null

describe('the word a fence is opened with', () => {
  /** The spellings people type, and what each has to come out as. Every one of
   *  these is a fence somebody has written; the point of the list is that the
   *  short spelling and the long one land in the same place. */
  const expected: Record<string, string> = {
    // Two or three ways to say the same everyday language.
    js: 'JavaScript',
    javascript: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    node: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    mts: 'TypeScript',
    tsx: 'TSX',
    jsx: 'JSX',
    py: 'Python',
    python: 'Python',
    python3: 'Python',
    rb: 'Ruby',
    ruby: 'Ruby',
    rs: 'Rust',
    rust: 'Rust',
    go: 'Go',
    golang: 'Go',
    kt: 'Kotlin',
    kts: 'Kotlin',
    cs: 'C#',
    csharp: 'C#',
    'c#': 'C#',
    'c++': 'C++',
    cpp: 'C++',
    hpp: 'C++',
    c: 'C',
    h: 'C',
    objc: 'Objective-C',
    'objective-c': 'Objective-C',
    swift: 'Swift',
    php: 'PHP',
    jl: 'Julia',
    hs: 'Haskell',
    clj: 'Clojure',
    cljs: 'ClojureScript',
    ml: 'OCaml',
    fs: 'F#',
    erl: 'Erlang',
    cuda: 'C++',
    ex: 'Elixir',
    exs: 'Elixir',
    elixir: 'Elixir',
    matlab: 'Octave',
    racket: 'Scheme',
    elisp: 'Common Lisp',
    delphi: 'Pascal',
    raku: 'Perl',

    // Shells, and the transcripts people paste out of one.
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    fish: 'Shell',
    console: 'Shell',
    'shell-session': 'Shell',
    ps1: 'PowerShell',
    powershell: 'PowerShell',
    pwsh: 'PowerShell',

    // Markup and the web.
    html: 'HTML',
    htm: 'HTML',
    hbs: 'HTML',
    svg: 'XML',
    vue: 'Vue',
    svelte: 'Svelte',
    astro: 'HTML',
    md: 'Markdown',
    markdown: 'Markdown',
    scss: 'SCSS',

    // Data, configuration and the files a repository is full of.
    yml: 'YAML',
    yaml: 'YAML',
    helm: 'YAML',
    compose: 'YAML',
    k8s: 'YAML',
    json: 'JSON',
    json5: 'JSON',
    jsonc: 'JSON',
    toml: 'TOML',
    ini: 'Properties files',
    env: 'Properties files',
    dotenv: 'Properties files',
    systemd: 'Properties files',
    tf: 'Terraform',
    terraform: 'Terraform',
    hcl: 'Terraform',
    nix: 'Nix',
    make: 'Makefile',
    makefile: 'Makefile',
    graphql: 'GraphQL',
    gql: 'GraphQL',
    prisma: 'Prisma',
    dockerfile: 'Dockerfile',
    docker: 'Dockerfile',
    proto: 'ProtoBuf',
    protobuf: 'ProtoBuf',
    diff: 'diff',
    patch: 'diff',
    wat: 'WebAssembly',
    asm: 'Gas',

    // SQL, which is a family rather than a language.
    sql: 'SQL',
    psql: 'PostgreSQL',
    postgres: 'PostgreSQL',
    tsql: 'MS SQL',
    sqlite3: 'SQLite',

    // Languages added here for want of a maintained grammar anywhere else.
    zig: 'Zig',
    bicep: 'Bicep',
    awk: 'AWK',
    glsl: 'GLSL',
    solidity: 'Solidity',

    // A fence that says it is not code.
    plaintext: 'Plain Text',
    text: 'Plain Text',
    txt: 'Plain Text',
    none: 'Plain Text',
    nohighlight: 'Plain Text',
    rst: 'Plain Text',
  }

  for (const [word, language] of Object.entries(expected)) {
    test(`\`\`\`${word} is ${language}`, () => {
      expect(languageFor(word)).toBe(language)
    })
  }

  test('the spelling is read whatever case it is written in', () => {
    expect(languageFor('Python')).toBe('Python')
    expect(languageFor('JSON')).toBe('JSON')
    expect(languageFor('Dockerfile')).toBe('Dockerfile')
  })

  /** The near-match rule reads a word that merely *contains* a language's
   *  name as that language, so a spelling added here can quietly swallow one
   *  nobody has a grammar for. These three have none, and have to stay that
   *  way rather than be coloured as something they are not. */
  test('a word nobody has a language for stays plain code', () => {
    expect(languageFor('notalanguage')).toBeNull()
    expect(languageFor('')).toBeNull()
    expect(languageFor('rescript')).toBeNull()
    expect(languageFor('applescript')).toBeNull()
    expect(languageFor('gleam')).toBeNull()
  })
})

describe('the list itself', () => {
  test('every language is named once', () => {
    const names = languages.map((language) => language.name)
    expect(names).toHaveLength(new Set(names).size)
  })

  test('no two languages answer to the same word', () => {
    const claimed = new Map<string, string>()

    for (const language of languages) {
      for (const word of language.alias) {
        expect(claimed.get(word) ?? language.name, `\`\`\`${word}`).toBe(language.name)
        claimed.set(word, language.name)
      }
    }
  })

  /** A spelling filed against a name the stock list does not use is a line
   *  that quietly does nothing, which is the one way this file can rot. */
  test('every spelling is filed against a language that exists', () => {
    for (const [name, spellings] of Object.entries(SPELLINGS)) {
      expect(
        stock.some((original) => original.name === name),
        name,
      ).toBe(true)

      for (const word of spellings) expect(languageFor(word), `\`\`\`${word}`).toBe(name)
    }
  })

  test('the stock list is still here in full', () => {
    for (const original of stock) {
      const language = languages.find((other) => other.name === original.name)
      expect(language?.alias, original.name).toEqual(expect.arrayContaining([...original.alias]))
    }
  })
})

describe('what a fence is besides code', () => {
  /** Mermaid, flow and sequence fences are drawn as pictures rather than
   *  coloured as code, and the Run button reads the same word again. Both look
   *  the fence's language up their own way, so neither is protected by the
   *  list above. */
  test('the fences drawn as pictures still are', () => {
    expect([...DIAGRAM_LANGUAGES]).toEqual(['mermaid', 'flow', 'sequence'])
    expect(languageFor('mermaid')).toBe('mermaid')
  })

  test('the fences the run button appears on still are', () => {
    for (const word of ['js', 'javascript', 'mjs', 'cjs']) {
      expect(isRunnableLanguage(word), word).toBe(true)
      expect(languageFor(word)).toBe('JavaScript')
    }

    for (const word of ['ts', 'python', 'node']) expect(isRunnableLanguage(word)).toBe(false)
  })

  /** A clipped page chooses its own fence languages, and two of the app's own are
   *  not blocks that show something: a `query` fence searches the reader's space as
   *  the note renders, and an `ai` fence reads its body as a prompt. The converter
   *  refuses those two by name - it cannot import this package, which is its
   *  dependent - so this is where the two lists are held to each other.
   *
   *  What is deliberately not refused: the drawn fences and the runnable ones. A
   *  clipped page of documentation is the commonest clip there is and its fences say
   *  `js` and `mermaid`; the Run glyph wants a press and runs in a frame sandboxed
   *  with `allow-scripts` alone. See `THE_APP_S_OWN` in @nib/markdown's from-html.ts,
   *  which carries the whole of the reasoning. */
  test('the two a clipped page may not choose are the two that need no press', () => {
    const fenced = (language: string) =>
      htmlToMarkdown(`<pre data-language="${language}"><code>x</code></pre>`)

    const block = (language: string) => ['```' + language, 'x', '```'].join('\n')

    expect(fenced('query')).toBe(block(''))
    expect(fenced('ai')).toBe(block(''))

    // And every other language the app does something with keeps its name.
    for (const word of [...DIAGRAM_LANGUAGES, 'chart', 'js', 'javascript', 'mjs', 'cjs']) {
      expect(fenced(word), word).toBe(block(word))
    }
  })
})

describe('loading a language', () => {
  /** One of each mechanism: a stock description that was given more
   *  spellings, a CodeMirror 5 mode, a language described by its vocabulary,
   *  a package written for CodeMirror 6, and one of this repo's own. */
  const sample = [
    'py',
    'rs',
    'glsl',
    'awk',
    'zig',
    'elixir',
    'nix',
    'svelte',
    'solidity',
    'terraform',
    'makefile',
    'graphql',
    'prisma',
    'plaintext',
    'mermaid',
  ]

  for (const word of sample) {
    test(`\`\`\`${word} loads and parses`, async () => {
      const description = LanguageDescription.matchLanguageName(languages, word, true)!
      const support = await description.load()

      expect(support.language.parser.parse('x')).toBeTruthy()
    })
  }
})

describe('the token types this repo names itself', () => {
  /** A token type CodeMirror has no tag for is not an error. It is one
   *  `console.warn` at startup and a token with no colour for ever after,
   *  which is exactly the kind of thing that goes unnoticed for a year. */
  const known = (type: string) =>
    type
      .split('.')
      .every((part, index) =>
        index === 0
          ? typeof (tags as Record<string, unknown>)[part] === 'object'
          : typeof (tags as Record<string, unknown>)[part] === 'function',
      )

  const samples: [string, StreamParser<never>, string][] = [
    ['mermaid', mermaidParser as StreamParser<never>, 'graph TD\n  A["a"] --> B\n  %% a note'],
    [
      'makefile',
      makefileParser as StreamParser<never>,
      '# build\nCC := gcc\nall: $(OBJ)\n\t$(CC) -o "app" main.c\nifeq ($(OS),nt)\nendif',
    ],
    [
      'graphql',
      graphqlParser as StreamParser<never>,
      '# a schema\n"""doc"""\ntype User {\n  id: ID!\n  posts(n: 10): [Post!]! @cache\n}\nquery H($id: ID) { user }',
    ],
    [
      'prisma',
      prismaParser as StreamParser<never>,
      '// a schema\ndatasource db {\n  url = env("DB")\n}\nmodel User {\n  id Int @id @default(3)\n  posts Post[]\n}',
    ],
  ]

  for (const [name, parser, sample] of samples) {
    test(`${name} names only tags CodeMirror knows`, () => {
      const state = parser.startState!(2)

      for (const line of sample.split('\n')) {
        const stream = new StringStream(line, 2, 2)

        while (!stream.eol()) {
          const type = parser.token(stream, state)
          expect(type === null || known(type), `${name}: ${type}`).toBe(true)
        }
      }
    })
  }
})
