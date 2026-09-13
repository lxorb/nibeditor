/** Which opener a row of the file list is for.
 *
 *  A PDF opens in the viewer, a `.url` in the browser, a page note in the
 *  handwriting surface, a canvas on the plane, and everything else as a note. The
 *  routing is one decision made from three facts - the path, whether a `url:` note
 *  sits at it, and which build this is - and it was a ladder of `if`s buried in the
 *  middle of `openEntry`, where the one part of opening that is a decision rather
 *  than machinery could not be read or tested apart from the tabs it makes.
 *
 *  Pure, so a branch for every kind and every build is one line each; see
 *  openers.test.ts. `workspace.openEntry` reads the answer and runs the opener the
 *  class holds, because making a tab is the class's own core loop and stays there;
 *  see the workspace section of docs/conventions.md. */

import { isCanvasTarget, isPagesTarget, isPdfTarget, isWebTarget } from '@nib/markdown/links'
import { isMarkdownPath } from './space-paths'

/** What opens a path, or null where this build cannot show it. */
export type Opener = 'pdf' | 'web' | 'pages' | 'canvas' | 'note'

/** What the build is, for the two kinds a pair of glasses cannot draw.
 *
 *  Two flags rather than one, because the app answers the question two ways and both
 *  have to be honoured: a PDF asks the build-time define, since the viewer is not
 *  compiled into the plugin at all, while a page note and a canvas ask the runtime
 *  latch, since the same build is both the app and the plugin depending on which
 *  entry ran. See `__EVEN_PLUGIN__` and `isPlugin` in plugin.ts. */
export interface Build {
  /** The plugin's own build, from which the PDF viewer is left out. */
  evenBuild: boolean
  /** This page is the plugin rather than the app. */
  isPlugin: boolean
}

/** The opener for a path.
 *
 *  `isUrlNote` is asked rather than read, because whether a markdown note is really
 *  a website is the link index's to know - the pass that reads every note for its
 *  icon reads `url:` too - and a pure function does not reach for a store. A note
 *  the index has not caught up with opens as the note it also is, and the next pass
 *  settles it.
 *
 *  Null is "this build cannot show it", which is only ever the plugin: a PDF, a
 *  canvas and a page note each want a surface the glasses have not got, so on the
 *  plugin they open nothing rather than a tab a reader cannot get out of by looking
 *  up. A `.url` is not guarded here - `openWeb` declines it in the plugin itself, so
 *  that a shortcut still counts as a website everywhere the routing is read. */
export function openerFor(
  path: string,
  isUrlNote: (path: string) => boolean,
  build: Build,
): Opener | null {
  if (isPdfTarget(path)) return build.evenBuild ? null : 'pdf'
  if (isWebTarget(path)) return 'web'
  if (isMarkdownPath(path) && isUrlNote(path)) return 'web'
  if (isPagesTarget(path)) return build.isPlugin ? null : 'pages'
  if (isCanvasTarget(path)) return build.isPlugin ? null : 'canvas'

  return 'note'
}
