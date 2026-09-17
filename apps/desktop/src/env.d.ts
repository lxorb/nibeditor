/// <reference types="vite/client" />

/** Which build this is: the plugin's version, the commit it was built from, and
 *  when. Baked in by `vite.config.ts` so a screenshot of a phone can say whether
 *  the code on it is the code somebody just shipped. */
declare const __EVEN_BUILD__: string

/** True in the build that becomes the Even Realities plugin, and false in the
 *  desktop and web builds.
 *
 *  A constant rather than a runtime check, because what it is for is leaving code
 *  *out*: the branches it guards are removed by the bundler, and with them every
 *  library they reach. The plugin ships no code execution at all - Emil's decision
 *  and the store reviewer's finding - and no diagram renderer, no document
 *  exporter and no PDF viewer, none of which a pair of glasses can use and each of
 *  which brought URLs and `new Function` into a bundle that is reviewed for both.
 *
 *  See vite.even.config.ts, and the two tests that hold the staged bundle to it. */
declare const __EVEN_PLUGIN__: boolean

/** Whether this build lets a drive steer it: `window.nibApp` and `window.nib`.
 *
 *  It replaced `import.meta.env.DEV` on those two handles, and the difference is
 *  the point. Every drive in `test/e2e` reaches the app through them, and DEV is
 *  false in a bundle, so for as long as that was the guard the only build anything
 *  could drive was the one nobody ships. The hole was found the hard way: three
 *  bugs were reported that could not be reproduced in any build a drive could
 *  reach, and there was no way to ask the shipped bundle the same question.
 *
 *  True while a dev server is serving, and in a build made with `--mode drive`,
 *  which is a release build in every other respect - minified, tree-shaken, the
 *  real chunks - so a drive against it is a drive against what ships. True in a
 *  development build too, which is what every drive but smoke.py builds for itself:
 *  those all run `vite build`, so the alternative was a handle stripped out of the
 *  one build they were about to wait for. False in an actual release, because these
 *  handles are the whole workspace and the page they sit on renders other people's
 *  HTML.
 *
 *  A constant rather than a runtime flag, so a real release does not merely refuse
 *  to answer: the bundler removes the branch and the handles are not there at all.
 *  See vite.config.ts, and smoke.py, which drives both. */
declare const __DRIVEABLE__: boolean

/** The build-time settings this app reads. Vite types every `VITE_` name as
 *  `any` by default, and an `any` spreading out of `import.meta.env` is how a
 *  missing variable becomes a URL of `undefined` at runtime. Named here, so the
 *  compiler knows a value may be absent and the code has to say what then. */
interface ImportMetaEnv {
  /** Where the sync service lives, for pointing a development build at a local
   *  one. Unset in a normal build, which sends the app at the hosted service. */
  readonly VITE_NIB_API?: string
  /** Where the theme store's catalogue is served from, for working on a theme
   *  before it is published: a local folder, or the registry's raw files.
   *  Unset in a normal build, which reads it through the sync service. */
  readonly VITE_NIB_THEMES?: string
}
