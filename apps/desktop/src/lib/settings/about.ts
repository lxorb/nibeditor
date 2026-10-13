/** What Settings > General > About says about this build: the version, what kind of
 *  build it is and what it runs on, and the line Copy puts on the clipboard for a bug
 *  report, the way VS Code's About dialog copies its version, commit, engine and system.
 *
 *  Pure, so what the row says is a test rather than a launch; the row itself is
 *  `aboutRows` in SettingsPanel.svelte. */

/** What the row is handed. `stamp` is `__EVEN_BUILD__`: the version, the commit and
 *  when it was built, or a dev server's own words (see `stamp` in vite.config.ts). */
export interface Build {
  version: string
  stamp: string
  /** The engine the pages run on, by the name a person knows it by; empty where there
   *  is none to name. */
  engine: string
  /** The system, as the os plugin names it; empty in a browser. */
  os: string
}

export interface About {
  /** The number, as the installer carries it. */
  version: string
  /** A build of main, by its number, or a release: `edge` and `stable` as words the
   *  row translates. */
  kind: { edge: number } | 'stable'
  /** The whole of it on one line, for a bug report. */
  copied: string
}

/** The systems by the names their makers give them. */
const SYSTEMS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android',
}

/** Every push to main is `x.y.z-N`, N the run that built it, and a release is `x.y.z`;
 *  see scripts/build-version.sh. */
export function about(build: Build): About {
  const edge = /^\d+\.\d+\.\d+-(\d+)$/.exec(build.version)?.[1]
  const [, commit] = build.stamp.split(' ')
  const sha = commit && /^[0-9a-f]{7,}$/.test(commit) ? commit : ''

  return {
    version: build.version,
    kind: edge ? { edge: Number(edge) } : 'stable',
    copied: [
      [build.version, sha].filter(Boolean).join(' '),
      build.engine,
      SYSTEMS[build.os] ?? build.os,
    ]
      .filter(Boolean)
      .join(' · '),
  }
}
